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
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Category, CategoryType } from "../../entity/Category";
import { CreateCategoryDto, UpdateCategoryDto } from "../../dto/admin/Category.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

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
  @UseBefore(canAccess("categories", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateCategoryDto, @Res() res: any) {
    try {
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
  @UseBefore(canAccess("categories", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("type") type: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (search) {
        where.name = { $regex: search, $options: "i" };
      }
      if (type) {
        where.type = type;
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
  @UseBefore(canAccess("categories", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!category) throw new NotFoundError("Category not found");

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
  @UseBefore(canAccess("categories", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateCategoryDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Category not found");

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
  @UseBefore(canAccess("categories", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Category not found");

      category.isDeleted = true;
      await this.categoryRepo.save(category);

      return res.status(StatusCodes.OK).json({ message: "Category deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
