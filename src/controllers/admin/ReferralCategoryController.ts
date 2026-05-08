import {
  JsonController,
  Get,
  Post,
  Delete,
  Body,
  Param,
  QueryParam,
  Res,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Category, CategoryType } from "../../entity/Category";
import { CreateReferralCategoryDto } from "../../dto/admin/ReferralCategory.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/referral-categories")
@UseBefore(AuthMiddleware)
export class ReferralCategoryController {
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /api/referral-categories:
   *   post:
   *     summary: Create or update referral category mapping (Batch)
   *     tags: [Referral Category]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateReferralCategoryDto'
   */
  @Post("/")
  @UseBefore(canAccess("categories", "add"))
  async create(@Body() data: CreateReferralCategoryDto, @Res() res: any) {
    try {
      const subCategoryIds = data.subCategory
        .split(",")
        .map((id) => id.trim())
        .filter((id) => ObjectId.isValid(id));

      const referralParentId = data.refferalCategory;

      if (subCategoryIds.length === 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "No valid sub-category IDs provided"
        });
      }

      if (!ObjectId.isValid(referralParentId)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "Invalid referral category ID"
        });
      }

      // Perform batch update
      await this.categoryRepo.updateMany(
        { _id: { $in: subCategoryIds.map((id) => new ObjectId(id)) } } as any,
        { $set: { referralParent: new ObjectId(referralParentId) } }
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Referral categories linked successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/referral-categories:
   *   get:
   *     summary: List all sub-categories linked to a referral parent
   *     tags: [Referral Category]
   */
  @Get("/")
  @UseBefore(canAccess("categories", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = {
        isDeleted: false,
        type: CategoryType.SUB,
        referralParent: { $exists: true, $ne: null }
      };

      if (search) {
        where.name = { $regex: search, $options: "i" };
      }

      const [categories, total] = await this.categoryRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { updatedAt: "DESC" }
      });

      // Populate referral parent names for a better UI experience
      const referralParentIds = categories
        .map((c) => c.referralParent)
        .filter((id): id is ObjectId => !!id);

      const parents = referralParentIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: referralParentIds } } as any })
        : [];

      const parentMap = new Map(parents.map((p) => [p._id.toString(), p.name]));

      const data = categories.map((c) => ({
        _id: c._id,
        name: c.name,
        referralParent: c.referralParent ? {
          _id: c.referralParent,
          name: parentMap.get(c.referralParent.toString()) || "Unknown"
        } : null,
        status: c.status,
        updatedAt: c.createdAt
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/referral-categories/{id}:
   *   delete:
   *     summary: Unlink a sub-category from its referral parent
   *     tags: [Referral Category]
   */
  @Delete("/:id")
  @UseBefore(canAccess("categories", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        return res.status(StatusCodes.BAD_REQUEST).json({ message: "Invalid ID format" });
      }

      const category = await this.categoryRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!category) {
        return res.status(StatusCodes.NOT_FOUND).json({ message: "Category not found" });
      }

      // Unset the referralParent field
      // @ts-ignore - TypeORM Mongo allows unsetting via undefined or null depending on config
      category.referralParent = null;
      await this.categoryRepo.save(category);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Referral mapping removed successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
