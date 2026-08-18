import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseBefore,
  NotFoundError,
  BadRequestError,
  HttpCode,
  QueryParam
} from "routing-controllers";
import pagination from "../../utils/pagination";
import { AppDataSource } from "../../data-source";
import { OnlineStallProduct } from "../../entity/OnlineStallProduct";
import { Announcement } from "../../entity/Announcement";
import { Member } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { MarketplaceCategory } from "../../entity/MarketplaceCategory";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateOnlineStallProductDto, UpdateOnlineStallProductDto } from "../../dto/mobile/OnlineStallProduct.dto";
import { validateModuleUsage } from "../../services/moduleUsage.service";
import { PointService } from "../../services/point.service";
import { PointConfigType } from "../../entity/PointConfig";

@JsonController("/online-stall-products")
@UseBefore(MobileAuthMiddleware)
export class MobileOnlineStallProductController {
  private productRepo = AppDataSource.getMongoRepository(OnlineStallProduct);
  private announcementRepo = AppDataSource.getMongoRepository(Announcement);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /mobile-api/online-stall-products:
   *   post:
   *     summary: Create an online stall product (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateOnlineStallProductDto'
   *     responses:
   *       201:
   *         description: Product created successfully
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() body: CreateOnlineStallProductDto, @Res() res: any) {
    try {
      const { productName, description, price, images, location, endDate, marketplaceCategory } = body;

      if (!ObjectId.isValid(marketplaceCategory)) {
        throw new BadRequestError("Invalid marketplace category ID");
      }

      const mCategory = await AppDataSource.getMongoRepository(MarketplaceCategory).findOneBy({
        _id: new ObjectId(marketplaceCategory),
        isDeleted: false
      });
      if (!mCategory) {
        throw new NotFoundError("Marketplace category not found");
      }

      const finalMemberId = new ObjectId(req.user.userId);

      // Validate Online Stall capacity under the plan
      await validateModuleUsage(finalMemberId, "Marketplace");

      // Check points balance and deduct points
      const pointService = new PointService();
      const config = await pointService.getPointConfig("Marketplace", PointConfigType.SPENT);
      const pointsToDeduct = config ? config.points : 0;

      const member = await this.memberRepo.findOneBy({ _id: finalMemberId, isDeleted: false });
      if (!member) {
        throw new NotFoundError("Member not found");
      }

      if (pointsToDeduct > 0 && (member.points || 0) < pointsToDeduct) {
        throw new BadRequestError(`Insufficient points. You need ${pointsToDeduct} points.`);
      }

      let finalEndDate: Date | undefined;
      if (endDate) {
        finalEndDate = new Date(endDate);
      } else {
        finalEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      }

      const product = this.productRepo.create({
        productName,
        description,
        price: Number(price),
        images: images || [],
        memberId: finalMemberId,
        isDeleted: false,
        location,
        endDate: finalEndDate,
        marketplaceCategory: new ObjectId(marketplaceCategory)
      });

      const saved = await this.productRepo.save(product);

      // Deduct points from history and balance
      let remainingPoints = member.points;
      if (pointsToDeduct > 0) {
        try {
          const deductResult = await pointService.deductPoints({
            memberId: finalMemberId,
            moduleName: "Marketplace",
            points: pointsToDeduct,
            referenceId: saved._id,
            actionType: "spent"
          });
          remainingPoints = deductResult.balance;
        } catch (pointError) {
          console.error("Failed to record marketplace points deduction in history:", pointError);
          member.points = Math.max(0, (member.points || 0) - pointsToDeduct);
          await this.memberRepo.save(member);
          remainingPoints = member.points;
        }
      }

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Product created successfully",
        data: saved,
        remainingPoints,
        pointsSpent: pointsToDeduct
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/online-stall-products:
   *   get:
   *     summary: Get all online stall products (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 0
   *         description: Page number (0-indexed)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *         description: Items per page
   *       - in: query
   *         name: categoryId
   *         schema:
   *           type: string
   *         description: Filter products by marketplace category ID
   *       - in: query
   *         name: marketplaceCategoryId
   *         schema:
   *           type: string
   *         description: Alias for categoryId
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search products by name
   *     responses:
   *       200:
   *         description: Paginated list of products
   */
  @Get("/")
  async getByEvent(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("categoryId") categoryId: string,
    @QueryParam("marketplaceCategoryId") marketplaceCategoryId: string,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    try {
      const loggedInUserId = req.user.userId;
      const loggedInMember = await this.memberRepo.findOneBy({
        _id: new ObjectId(loggedInUserId),
        isDeleted: false
      });
      if (!loggedInMember) {
        throw new NotFoundError("Logged-in member not found");
      }

      const pageNum = Number(page) || 0;
      const limitNum = Number(limit) || 10;

      const selectedCategory = categoryId || marketplaceCategoryId;

      // 1. Initial product match criteria
      const matchStage: any = {
        isDeleted: false
      };

      if (selectedCategory && ObjectId.isValid(selectedCategory)) {
        matchStage.marketplaceCategory = new ObjectId(selectedCategory);
      }

      if (search && search.trim()) {
        matchStage.productName = { $regex: search.trim(), $options: "i" };
      }

      // 2. Member match criteria for location access rules
      const memberMatchStage: any = {
        "member.isDeleted": false
      };

      const loggedInRegion = loggedInMember.businessRegion;
      if (loggedInRegion) {
        const regOid = new ObjectId(loggedInRegion.toString());
        memberMatchStage.$or = [
          { location: { $ne: "region" } },
          { "member.businessRegion": regOid },
          { "member.businessRegion": regOid.toString() }
        ];
      } else {
        memberMatchStage.location = { $ne: "region" };
      }

      // 3. Aggregate pipeline
      const pipeline: any[] = [
        { $match: matchStage },
        {
          $lookup: {
            from: "members",
            localField: "memberId",
            foreignField: "_id",
            as: "member"
          }
        },
        {
          $unwind: {
            path: "$member",
            preserveNullAndEmptyArrays: false
          }
        },
        { $match: memberMatchStage },
        {
          $lookup: {
            from: "marketplace_categories",
            localField: "marketplaceCategory",
            foreignField: "_id",
            as: "marketplaceCategoryDoc"
          }
        },
        {
          $unwind: {
            path: "$marketplaceCategoryDoc",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "categories",
            localField: "member.businessCategory",
            foreignField: "_id",
            as: "memberCategoryDoc"
          }
        },
        {
          $unwind: {
            path: "$memberCategoryDoc",
            preserveNullAndEmptyArrays: true
          }
        },
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            metadata: [{ $count: "total" }],
            data: [
              { $skip: pageNum * limitNum },
              { $limit: limitNum },
              {
                $project: {
                  _id: 1,
                  productName: 1,
                  description: 1,
                  price: 1,
                  images: 1,
                  memberId: 1,
                  isDeleted: 1,
                  location: 1,
                  endDate: 1,
                  createdAt: 1,
                  updatedAt: 1,
                  daysRemaining: {
                    $cond: {
                      if: {
                        $and: [
                          { $ifNull: ["$endDate", false] },
                          { $gt: ["$endDate", new Date()] }
                        ]
                      },
                      then: {
                        $ceil: {
                          $divide: [
                            { $subtract: ["$endDate", new Date()] },
                            1000 * 60 * 60 * 24
                          ]
                        }
                      },
                      else: 0
                    }
                  },
                  marketplaceCategory: {
                    $cond: {
                      if: "$marketplaceCategoryDoc",
                      then: {
                        _id: "$marketplaceCategoryDoc._id",
                        name: "$marketplaceCategoryDoc.name"
                      },
                      else: null
                    }
                  },
                  member: {
                    _id: "$member._id",
                    fullName: "$member.fullName",
                    profilePhoto: "$member.profilePhoto",
                    businessCategory: { $ifNull: ["$memberCategoryDoc.name", ""] }
                  },
                  memberName: "$member.fullName",
                  profile: { $ifNull: ["$member.profilePhoto", ""] },
                  category: { $ifNull: ["$memberCategoryDoc.name", ""] }
                }
              }
            ]
          }
        }
      ];

      const aggregateResult = await this.productRepo.aggregate(pipeline).toArray();
      const result = aggregateResult[0] || {};
      const total = result.metadata?.[0]?.total || 0;
      const responseData = result.data || [];

      return pagination(total, responseData, limitNum, pageNum, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/online-stall-products/my-products:
   *   get:
   *     summary: Get logged in member's products (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 0
   *         description: Page number (0-indexed)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *         description: Number of products per page
   *     responses:
   *       200:
   *         description: List of member's products
   */
  @Get("/my-products")
  async getMyProducts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId;

      const pageNum = Number(page) || 0;
      const limitNum = Number(limit) || 10;

      const [products, total] = await this.productRepo.findAndCount({
        where: {
          memberId: new ObjectId(userId),
          isDeleted: false
        },
        order: { createdAt: "DESC" },
        skip: pageNum * limitNum,
        take: limitNum
      });

      // Extract unique marketplace category IDs from products
      const mCategoryIds = Array.from(
        new Set(
          products
            .map(p => p.marketplaceCategory?.toString())
            .filter((id): id is string => !!id)
        )
      ).map(id => new ObjectId(id));

      const mCategories = mCategoryIds.length > 0
        ? await AppDataSource.getMongoRepository(MarketplaceCategory).find({ where: { _id: { $in: mCategoryIds } } as any })
        : [];
      const mCategoryMap = new Map(mCategories.map(c => [c._id.toString(), { _id: c._id, name: c.name }]));

      const now = new Date();
      const responseData = products.map(p => {
        let daysRemaining = 0;
        if (p.endDate) {
          const diffTime = new Date(p.endDate).getTime() - now.getTime();
          daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        }

        return {
          ...p,
          daysRemaining,
          marketplaceCategory: p.marketplaceCategory ? mCategoryMap.get(p.marketplaceCategory.toString()) || null : null
        };
      });

      return pagination(total, responseData, limitNum, pageNum, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/online-stall-products/categories:
   *   get:
   *     summary: Get marketplace categories that have active products (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of categories with product counts
   */
  @Get("/categories")
  async getCategoriesWithProducts(@Req() req: any, @Res() res: any) {
    try {
      const loggedInUserId = req.user.userId;
      const loggedInMember = await this.memberRepo.findOneBy({
        _id: new ObjectId(loggedInUserId),
        isDeleted: false
      });
      if (!loggedInMember) {
        throw new NotFoundError("Logged-in member not found");
      }

      const memberMatchStage: any = {
        "member.isDeleted": false
      };

      const loggedInRegion = loggedInMember.businessRegion;
      if (loggedInRegion) {
        const regOid = new ObjectId(loggedInRegion.toString());
        memberMatchStage.$or = [
          { location: { $ne: "region" } },
          { "member.businessRegion": regOid },
          { "member.businessRegion": regOid.toString() }
        ];
      } else {
        memberMatchStage.location = { $ne: "region" };
      }

      const pipeline: any[] = [
        { $match: { isDeleted: false } },
        {
          $lookup: {
            from: "members",
            localField: "memberId",
            foreignField: "_id",
            as: "member"
          }
        },
        {
          $unwind: {
            path: "$member",
            preserveNullAndEmptyArrays: false
          }
        },
        { $match: memberMatchStage },
        {
          $group: {
            _id: "$marketplaceCategory",
            productCount: { $sum: 1 }
          }
        },
        {
          $match: {
            _id: { $ne: null }
          }
        },
        {
          $lookup: {
            from: "marketplace_categories",
            localField: "_id",
            foreignField: "_id",
            as: "categoryDoc"
          }
        },
        {
          $unwind: {
            path: "$categoryDoc",
            preserveNullAndEmptyArrays: false
          }
        },
        {
          $match: {
            "categoryDoc.isDeleted": false
          }
        },
        {
          $project: {
            _id: "$categoryDoc._id",
            name: "$categoryDoc.name",
            productCount: 1
          }
        },
        { $sort: { name: 1 } }
      ];

      const categories = await this.productRepo.aggregate(pipeline).toArray();

      return res.status(StatusCodes.OK).json({
        success: true,
        data: categories
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/online-stall-products/{id}:
   *   get:
   *     summary: Get single product details (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Product details
   *       404:
   *         description: Product not found
   */
  @Get("/:id([0-9a-fA-F]{24})")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID");
      }

      const product = await this.productRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: product
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/online-stall-products/{id}:
   *   put:
   *     summary: Update an online stall product (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateOnlineStallProductDto'
   *     responses:
   *       200:
   *         description: Product updated successfully
   */
  @Put("/:id([0-9a-fA-F]{24})")
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: UpdateOnlineStallProductDto,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId;
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID");
      }

      const product = await this.productRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      // Restrict modification to the owner
      if (product.memberId.toString() !== userId) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "You are not authorized to update this product"
        });
      }

      Object.assign(product, body);
      if (body.price !== undefined) {
        product.price = Number(body.price);
      }
      if (body.marketplaceCategory !== undefined) {
        product.marketplaceCategory = new ObjectId(body.marketplaceCategory);
      }
      const saved = await this.productRepo.save(product);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Product updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/online-stall-products/{id}:
   *   delete:
   *     summary: Soft delete an online stall product (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Product deleted successfully
   */
  @Delete("/:id([0-9a-fA-F]{24})")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const userId = req.user.userId;
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID");
      }

      const product = await this.productRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      // Restrict deletion to the owner
      if (product.memberId.toString() !== userId) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "You are not authorized to delete this product"
        });
      }

      product.isDeleted = true;
      await this.productRepo.save(product);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Product deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
