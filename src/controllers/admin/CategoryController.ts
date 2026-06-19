import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  UseBefore,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Category, CategoryType } from "../../entity/Category";
import { CreateCategoryDto, UpdateCategoryDto } from "../../dto/admin/Category.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { hasPermission } from "../../utils/common.function";

@JsonController("/categories")
@UseBefore(AuthMiddleware)
export class CategoryController {
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /api/admin/categories:
   *   post:
   *     summary: Create a new category
   *     tags: [Category]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateCategoryDto'
   *     responses:
   *       201:
   *         description: Category created successfully
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateCategoryDto, @Res() res: any, @Req() req: any) {
    try {
      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (data.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (data.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (data.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "create"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      const category = new Category();
      category.name = data.name;
      category.type = data.type;
      category.status = data.status || category.status;
      category.isDeleted = false;

      if (data.type === CategoryType.SUB && data.parentCategory) {
        category.parentCategory = new ObjectId(data.parentCategory);
      }

      if (data.type === CategoryType.REFERRAL && data.referralParent) {
        category.referralParent = new ObjectId(data.referralParent);
      }

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.CREATED).json(saved);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories:
   *   get:
   *     summary: Get all categories with pagination and search
   *     tags: [Category]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: type
   *         schema: { type: string, enum: [MAIN, SUB, REFERRAL] }
   *     responses:
   *       200:
   *         description: List of categories
   */
  @Get("/")
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("referralParent") referralParent: string,
    @QueryParam("parentCategory") parentCategory: string,
    @QueryParam("type") type: string,
    @Res() res: any,
    @Req() req: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      let allowed = isSuperAdmin;
      if (!allowed) {
        if (requiredModule !== "categories") {
          allowed = await hasPermission(role, requiredModule, "view");
        } else {
          allowed = (await hasPermission(role, "categories", "view")) ||
                    (await hasPermission(role, "main_categories", "view")) ||
                    (await hasPermission(role, "sub_categories", "view")) ||
                    (await hasPermission(role, "referral_categories", "view"));
        }
      }

      if (!allowed) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }
      const where: any = { isDeleted: false };
      if (search) {
        where.name = { $regex: search, $options: "i" };
      }
      if (parentCategory && ObjectId.isValid(parentCategory)) {
        where.parentCategory = new ObjectId(parentCategory);
      }
      if (type) {
        if (type === CategoryType.REFERRAL) {
          where.type = CategoryType.SUB;
          where.referralParent = null;
        } else {
          where.type = type;
        }
      }

      if (referralParent) {
        where.referralParent = { $exists: referralParent === "true" };
        where.type = CategoryType.SUB;
      }

      const [categories, total] = await this.categoryRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // ✅ Manual Population for cleaner response
      const allCategoryIds = categories
        .flatMap(c => [c.parentCategory, c.referralParent])
        .filter((id): id is ObjectId => !!id);

      const parents = allCategoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: allCategoryIds } } as any })
        : [];

      const parentMap = new Map(parents.map(p => [p._id.toString(), { _id: p._id, name: p.name }]));

      // ✅ Get counts for Sub and Referral categories
      const categoryIds = categories.map(c => c._id);
      const subCounts = await this.categoryRepo.aggregate([
        { $match: { parentCategory: { $in: categoryIds }, isDeleted: false } },
        { $group: { _id: "$parentCategory", count: { $sum: 1 } } }
      ]).toArray();

      const referralCounts = await this.categoryRepo.aggregate([
        { $match: { referralParent: { $in: categoryIds }, isDeleted: false } },
        { $group: { _id: "$referralParent", count: { $sum: 1 } } }
      ]).toArray();

      const subCountMap = new Map(subCounts.map(s => [s._id.toString(), s.count]));
      const referralCountMap = new Map(referralCounts.map(r => [r._id.toString(), r.count]));

      const data = categories.map(c => ({
        ...c,
        parentCategory: c.parentCategory ? parentMap.get(c.parentCategory.toString()) : null,
        referralParent: c.referralParent ? parentMap.get(c.referralParent.toString()) : null,
        subCategoryCount: subCountMap.get(c._id.toString()) || 0,
        referralCount: referralCountMap.get(c._id.toString()) || 0
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories/{id}:
   *   get:
   *     summary: Get a single category by ID
   *     tags: [Category]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any, @Req() req: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!category) throw new NotFoundError("Category not found");

      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (category.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (category.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (category.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "view"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      // Populate parents
      const populated: any = { ...category };
      if (category.parentCategory) {
        const parent = await this.categoryRepo.findOneBy({ _id: category.parentCategory });
        populated.parentCategory = parent ? { _id: parent._id, name: parent.name } : null;
      }
      if (category.referralParent) {
        const ref = await this.categoryRepo.findOneBy({ _id: category.referralParent });
        populated.referralParent = ref ? { _id: ref._id, name: ref.name } : null;
      }

      // ✅ Add counts
      populated.subCategoryCount = await this.categoryRepo.count({
        where: { parentCategory: category._id, isDeleted: false }
      });
      populated.referralCount = await this.categoryRepo.count({
        where: { referralParent: category._id, isDeleted: false }
      });

      return res.status(StatusCodes.OK).json(populated);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories/{id}:
   *   put:
   *     summary: Update a category
   *     tags: [Category]
   */
  @Put("/:id")
  async update(@Param("id") id: string, @Body() data: UpdateCategoryDto, @Res() res: any, @Req() req: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Category not found");

      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (category.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (category.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (category.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "edit"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      if (data.name) category.name = data.name;
      if (data.status) category.status = data.status;
      if (data.parentCategory) category.parentCategory = new ObjectId(data.parentCategory);
      if (data.referralParent) category.referralParent = new ObjectId(data.referralParent);

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.OK).json(saved);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories/{id}:
   *   delete:
   *     summary: Delete a category (Soft Delete)
   *     tags: [Category]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any, @Req() req: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Category not found");

      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (category.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (category.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (category.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "delete"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      category.isDeleted = true;
      await this.categoryRepo.save(category);

      return res.status(StatusCodes.OK).json({ message: "Category deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
