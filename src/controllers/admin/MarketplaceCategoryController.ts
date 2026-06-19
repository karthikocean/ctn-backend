import {
  JsonController,
  Get,
  Post,
  Put,
  Patch,
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
import { MarketplaceCategory, MarketplaceCategoryStatus } from "../../entity/MarketplaceCategory";
import {
  CreateMarketplaceCategoryDto,
  UpdateMarketplaceCategoryDto,
  UpdateMarketplaceCategoryStatusDto
} from "../../dto/admin/MarketplaceCategory.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/marketplace-category")
@UseBefore(AuthMiddleware)
export class MarketplaceCategoryController {
  private categoryRepo = AppDataSource.getMongoRepository(MarketplaceCategory);

  /**
   * @swagger
   * /api/admin/marketplace-category:
   *   post:
   *     summary: Create a new marketplace category
   *     tags: [MarketplaceCategory]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateMarketplaceCategoryDto'
   *           example:
   *             name: Electronics
   *     responses:
   *       201:
   *         description: Marketplace category created successfully
   *         content:
   *           application/json:
   *             example:
   *               message: Marketplace category created successfully
   *               data:
   *                 _id: 60d21b4667d0d8992e610c85
   *                 name: Electronics
   *                 status: active
   *                 isDeleted: false
   *                 createdAt: "2024-01-01T00:00:00.000Z"
   *                 updatedAt: "2024-01-01T00:00:00.000Z"
   *       400:
   *         description: Marketplace category with this name already exists
   */
  @Post("/")
  @UseBefore(canAccess("marketplace_category", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateMarketplaceCategoryDto, @Res() res: any) {
    try {
      const trimmedName = data.name.trim();

      const existing = await this.categoryRepo.findOne({
        where: {
          name: { $regex: `^${trimmedName}$`, $options: "i" },
          isDeleted: false
        }
      });
      if (existing) {
        throw new BadRequestError("Marketplace category with this name already exists");
      }

      const category = new MarketplaceCategory();
      category.name = trimmedName;
      category.status = data.status ?? MarketplaceCategoryStatus.ACTIVE;
      category.isDeleted = false;

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.CREATED).json({
        message: "Marketplace category created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/marketplace-category:
   *   get:
   *     summary: Get all marketplace categories with pagination, search and status filter
   *     tags: [MarketplaceCategory]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *         description: Page number (0-indexed)
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *         description: Number of results per page
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search by category name
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [active, inactive] }
   *         description: Filter by status
   *     responses:
   *       200:
   *         description: Paginated list of marketplace categories
   *         content:
   *           application/json:
   *             example:
   *               status: 200
   *               message: Pagination successful
   *               total: 1
   *               from: 1
   *               to: 1
   *               totalPages: 1
   *               currentPage: 1
   *               data:
   *                 - _id: 60d21b4667d0d8992e610c85
   *                   name: Electronics
   *                   status: active
   *                   isDeleted: false
   *                   createdAt: "2024-01-01T00:00:00.000Z"
   *                   updatedAt: "2024-01-01T00:00:00.000Z"
   */
  @Get("/")
  @UseBefore(canAccess("marketplace_category", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (search) {
        where.name = { $regex: search, $options: "i" };
      }

      if (status) {
        where.status = status;
      }

      const [categories, total] = await this.categoryRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, categories, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/marketplace-category/{id}:
   *   get:
   *     summary: Get a single marketplace category by ID
   *     tags: [MarketplaceCategory]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Marketplace category ObjectId
   *     responses:
   *       200:
   *         description: Marketplace category details
   *         content:
   *           application/json:
   *             example:
   *               _id: 60d21b4667d0d8992e610c85
   *               name: Electronics
   *               status: active
   *               isDeleted: false
   *               createdAt: "2024-01-01T00:00:00.000Z"
   *               updatedAt: "2024-01-01T00:00:00.000Z"
   *       400:
   *         description: Invalid ID
   *       404:
   *         description: Marketplace category not found
   */
  @Get("/:id")
  @UseBefore(canAccess("marketplace_category", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!category) throw new NotFoundError("Marketplace category not found");

      return res.status(StatusCodes.OK).json(category);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/marketplace-category/{id}:
   *   put:
   *     summary: Update a marketplace category
   *     tags: [MarketplaceCategory]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateMarketplaceCategoryDto'
   *           example:
   *             name: Mobile Accessories
   *     responses:
   *       200:
   *         description: Marketplace category updated successfully
   *         content:
   *           application/json:
   *             example:
   *               message: Marketplace category updated successfully
   *               data:
   *                 _id: 60d21b4667d0d8992e610c85
   *                 name: Mobile Accessories
   *                 status: active
   *       400:
   *         description: Invalid ID or duplicate name
   *       404:
   *         description: Marketplace category not found
   */
  @Put("/:id")
  @UseBefore(canAccess("marketplace_category", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateMarketplaceCategoryDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Marketplace category not found");

      if (data.name) {
        const trimmedName = data.name.trim();

        const existing = await this.categoryRepo.findOne({
          where: {
            _id: { $ne: new ObjectId(id) },
            name: { $regex: `^${trimmedName}$`, $options: "i" },
            isDeleted: false
          }
        });
        if (existing) {
          throw new BadRequestError("Marketplace category with this name already exists");
        }
        category.name = trimmedName;
      }

      if (data.status) {
        category.status = data.status;
      }

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.OK).json({
        message: "Marketplace category updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/marketplace-category/{id}/status:
   *   patch:
   *     summary: Update marketplace category status (active/inactive)
   *     tags: [MarketplaceCategory]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateMarketplaceCategoryStatusDto'
   *           example:
   *             isActive: true
   *     responses:
   *       200:
   *         description: Status updated successfully
   *         content:
   *           application/json:
   *             example:
   *               message: Marketplace category status updated to Active
   *               status: active
   *       400:
   *         description: Invalid ID
   *       404:
   *         description: Marketplace category not found
   */
  @Patch("/:id/status")
  @UseBefore(canAccess("marketplace_category", "edit"))
  async updateStatus(
    @Param("id") id: string,
    @Body() statusData: UpdateMarketplaceCategoryStatusDto,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!category) throw new NotFoundError("Marketplace category not found");

      category.status = statusData.isActive
        ? MarketplaceCategoryStatus.ACTIVE
        : MarketplaceCategoryStatus.INACTIVE;

      await this.categoryRepo.save(category);

      return res.status(StatusCodes.OK).json({
        message: `Marketplace category status updated to ${statusData.isActive ? "Active" : "Inactive"}`,
        status: category.status
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/marketplace-category/{id}:
   *   delete:
   *     summary: Delete a marketplace category (Soft Delete)
   *     tags: [MarketplaceCategory]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Marketplace category deleted successfully
   *         content:
   *           application/json:
   *             example:
   *               message: Marketplace category deleted successfully
   *       400:
   *         description: Invalid ID
   *       404:
   *         description: Marketplace category not found
   */
  @Delete("/:id")
  @UseBefore(canAccess("marketplace_category", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Marketplace category not found");

      category.isDeleted = true;
      await this.categoryRepo.save(category);

      return res.status(StatusCodes.OK).json({
        message: "Marketplace category deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
