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
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { AppDataSource } from "../../data-source";
import { Module } from "../../entity/Module";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateModuleDto, UpdateModuleDto } from "../../dto/admin/Module.dto";

@JsonController("/modules")
@UseBefore(AuthMiddleware)
export class AdminModuleController {
  private moduleRepo = AppDataSource.getMongoRepository(Module);

  /**
   * @swagger
   * /api/admin/modules:
   *   post:
   *     summary: Create a new module
   *     tags: [Module]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       201:
   *         description: Module created successfully
   */
  @Post("/")
  @UseBefore(canAccess("modules", "create"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateModuleDto, @Res() res: any) {
    try {
      const trimmedName = data.name.trim();
      const slugName = trimmedName.toLowerCase();
      const existing = await this.moduleRepo.findOne({
        where: {
          slugName,
          isDelete: 0
        }
      });
      if (existing) {
        throw new BadRequestError("A module with this name already exists");
      }

      const module = new Module();
      Object.assign(module, {
        name: trimmedName,
        slugName,
        parentSlug: data.parentSlug || null,
        isActive: 1,
        isDelete: 0
      });

      const saved = await this.moduleRepo.save(module);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Module created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/modules:
   *   get:
   *     summary: List all modules with pagination and search
   *     tags: [Module]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 0
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Paginated list of modules
   */
  @Get("/")
  @UseBefore(canAccess("modules", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDelete: 0 };
      if (search) {
        where.name = { $regex: search, $options: "i" };
      }

      const [modules, total] = await this.moduleRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { sortOrder: "ASC", createdAt: "DESC" }
      });

      return pagination(total, modules, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/modules/{id}:
   *   get:
   *     summary: Get module details by ID
   *     tags: [Module]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Module details
   */
  @Get("/:id")
  @UseBefore(canAccess("modules", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID format");
      }

      const module = await this.moduleRepo.findOneBy({
        _id: new ObjectId(id),
        isDelete: 0
      });

      if (!module) {
        throw new NotFoundError("Module not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: module
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/modules/{id}:
   *   put:
   *     summary: Update an existing module
   *     tags: [Module]
   *     security:
   *       - BearerAuth: []
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
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       200:
   *         description: Module updated successfully
   */
  @Put("/:id")
  @UseBefore(canAccess("modules", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateModuleDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID format");
      }

      const module = await this.moduleRepo.findOneBy({
        _id: new ObjectId(id),
        isDelete: 0
      });

      if (!module) {
        throw new NotFoundError("Module not found");
      }

      if (data.name && data.name.trim() !== module.name) {
        const trimmedName = data.name.trim();
        const slugName = trimmedName.toLowerCase();
        const existing = await this.moduleRepo.findOne({
          where: {
            slugName,
            isDelete: 0,
            _id: { $ne: new ObjectId(id) }
          }
        });
        if (existing) {
          throw new BadRequestError("A module with this name already exists");
        }
        module.name = trimmedName;
        module.slugName = slugName;
      }

      if (data.parentSlug !== undefined) {
        module.parentSlug = data.parentSlug || null;
      }

      const saved = await this.moduleRepo.save(module);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Module updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/modules/{id}:
   *   delete:
   *     summary: Delete a module (Soft delete)
   *     tags: [Module]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Module deleted successfully
   */
  @Delete("/:id")
  @UseBefore(canAccess("modules", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID format");
      }

      const module = await this.moduleRepo.findOneBy({
        _id: new ObjectId(id),
        isDelete: 0
      });

      if (!module) {
        throw new NotFoundError("Module not found");
      }

      if (module.slugName === "modules" || module.name.toLowerCase() === "modules") {
        throw new BadRequestError("Core 'modules' module cannot be deleted");
      }

      module.isDelete = 1;
      await this.moduleRepo.save(module);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Module deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
