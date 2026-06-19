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
  HttpCode
} from "routing-controllers";
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
      await validateModuleUsage(finalMemberId, "MarketPlace");

      // Check points balance and deduct points
      const pointService = new PointService();
      const config = await pointService.getPointConfig("MarketPlace", PointConfigType.SPENT);
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
        finalEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
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
            moduleName: "MarketPlace",
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
   *     summary: Get all products for a specific event stall (Mobile)
   *     tags: [Mobile Online Stall Product]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of products
   */
  @Get("/")
  async getByEvent(@Req() req: any, @Res() res: any) {
    try {

      const loggedInUserId = req.user.userId;
      const loggedInMember = await this.memberRepo.findOneBy({
        _id: new ObjectId(loggedInUserId),
        isDeleted: false
      });
      if (!loggedInMember) {
        throw new NotFoundError("Logged-in member not found");
      }

      const products = await this.productRepo.find({
        where: {
          isDeleted: false
        },
        order: { createdAt: "DESC" }
      });

      if (!products || products.length === 0) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: []
        });
      }

      // Extract unique member IDs
      const memberIds = Array.from(
        new Set(products.map(p => p.memberId.toString()))
      ).map(id => new ObjectId(id));

      // Fetch member details
      const members = await this.memberRepo.find({
        where: {
          _id: { $in: memberIds } as any,
          isDeleted: false
        }
      });

      // Extract unique business category IDs from members
      const categoryIds = Array.from(
        new Set(
          members
            .map(m => m.businessCategory?.toString())
            .filter((id): id is string => !!id)
        )
      ).map(id => new ObjectId(id));

      // Fetch category details
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds }, isDeleted: false } as any })
        : [];

      // Create lookup maps
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));
      const categoryMap = new Map(categories.map(c => [c._id.toString(), c]));

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
      const loggedInRegion = loggedInMember.businessRegion?.toString();

      // Filter products based on location rules
      const filteredProducts = products.filter(product => {
        const productOwner = memberMap.get(product.memberId.toString());
        if (!productOwner) {
          return false; // Skip products from deleted/non-existent members
        }

        // If location is "region", owner's region must match logged-in user's region
        if (product.location === "region") {
          const ownerRegion = productOwner.businessRegion?.toString();
          return !!(ownerRegion && loggedInRegion && ownerRegion === loggedInRegion);
        }

        // If location is "Overall", list for everyone
        return true;
      });

      // Group products by memberId
      const groupedProducts = new Map<string, any[]>();
      for (const product of filteredProducts) {
        const mIdStr = product.memberId.toString();
        if (!groupedProducts.has(mIdStr)) {
          groupedProducts.set(mIdStr, []);
        }

        let daysRemaining = 0;
        if (product.endDate) {
          const diffTime = new Date(product.endDate).getTime() - now.getTime();
          daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        }

        const mappedProduct = {
          ...product,
          daysRemaining,
          marketplaceCategory: product.marketplaceCategory ? mCategoryMap.get(product.marketplaceCategory.toString()) || null : null
        };

        groupedProducts.get(mIdStr)!.push(mappedProduct);
      }

      const groupedData: any[] = [];
      for (const [mIdStr, memberProducts] of groupedProducts.entries()) {
        const member = memberMap.get(mIdStr);
        if (!member) {
          continue; // Skip products from deleted/non-existent members
        }

        const categoryIdStr = member.businessCategory?.toString();
        const categoryName = categoryIdStr ? categoryMap.get(categoryIdStr)?.name || "" : "";

        groupedData.push({
          memberId: mIdStr,
          memberName: member.fullName || "",
          profile: member.profilePhoto || "",
          category: categoryName,
          products: memberProducts
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: groupedData
      });
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
   *     responses:
   *       200:
   *         description: List of member's products
   */
  @Get("/my-products")
  async getMyProducts(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const products = await this.productRepo.find({
        where: {
          memberId: new ObjectId(userId),
          isDeleted: false
        },
        order: { createdAt: "DESC" }
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

      return res.status(StatusCodes.OK).json({
        success: true,
        data: responseData
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
  @Get("/:id")
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
  @Put("/:id")
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
  @Delete("/:id")
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
