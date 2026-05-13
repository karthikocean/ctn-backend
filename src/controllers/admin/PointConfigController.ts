import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { PointConfig } from "../../entity/PointConfig";
import { CreatePointConfigDto, UpdatePointConfigDto } from "../../dto/admin/PointConfig.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";

@JsonController("/point-configs")
@UseBefore(AuthMiddleware)
export class PointConfigController {
  private configRepo = AppDataSource.getMongoRepository(PointConfig);

  /**
   * @swagger
   * /api/admin/point-configs:
   *   post:
   *     summary: Create a new point configuration
   *     tags: [Point Config]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreatePointConfigDto, @Res() res: any) {
    try {
      // Check for duplicate module name and type (case-insensitive and not deleted)
      const existing = await this.configRepo.findOne({
        where: {
          moduleName: { $regex: new RegExp(`^${data.moduleName}$`, "i") },
          type: data.type,
          isDeleted: false
        }
      });

      if (existing) {
        throw new BadRequestError(`Module "${data.moduleName}" with type "${data.type}" already has a point configuration`);
      }

      const config = new PointConfig();
      config.moduleName = data.moduleName;
      config.type = data.type;
      config.points = data.points;
      config.isDeleted = false;

      const saved = await this.configRepo.save(config);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Point configuration created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/point-configs:
   *   get:
   *     summary: Get all point configurations
   *     tags: [Point Config]
   */
  @Get("/")
  async getAll(@Res() res: any) {
    try {
      const configs = await this.configRepo.find({
        where: { isDeleted: false },
        order: { moduleName: "ASC" }
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: configs
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/point-configs/{id}:
   *   get:
   *     summary: Get a point configuration by ID
   *     tags: [Point Config]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const config = await this.configRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!config) throw new NotFoundError("Configuration not found");

      return res.status(StatusCodes.OK).json({
        success: true,
        data: config
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/point-configs/{id}:
   *   put:
   *     summary: Update a point configuration
   *     tags: [Point Config]
   */
  @Put("/:id")
  async update(@Param("id") id: string, @Body() data: UpdatePointConfigDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const config = await this.configRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!config) throw new NotFoundError("Configuration not found");

      const moduleName = data.moduleName || config.moduleName;
      const type = data.type || config.type;

      if (data.moduleName || data.type) {
        const existing = await this.configRepo.findOne({
          where: {
            moduleName: { $regex: new RegExp(`^${moduleName}$`, "i") },
            type: type,
            _id: { $ne: new ObjectId(id) },
            isDeleted: false
          }
        });
        if (existing) throw new BadRequestError(`Module "${moduleName}" with type "${type}" already exists`);
        
        if (data.moduleName) config.moduleName = data.moduleName;
        if (data.type) config.type = data.type;
      }

      if (data.points !== undefined) config.points = data.points;

      const saved = await this.configRepo.save(config);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Configuration updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/point-configs/{id}:
   *   delete:
   *     summary: Delete a point configuration
   *     tags: [Point Config]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const config = await this.configRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!config) throw new NotFoundError("Configuration not found");

      config.isDeleted = true;
      await this.configRepo.save(config);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Configuration deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
