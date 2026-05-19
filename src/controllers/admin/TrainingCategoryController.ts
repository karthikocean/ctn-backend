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
import { TrainingCategory } from "../../entity/TrainingCategory";
import { CreateTrainingCategoryDto, UpdateTrainingCategoryDto } from "../../dto/admin/TrainingCategory.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/training-categories")
@UseBefore(AuthMiddleware)
export class TrainingCategoryController {
  private categoryRepo = AppDataSource.getMongoRepository(TrainingCategory);

  /**
   * @swagger
   * /api/admin/training-categories:
   *   post:
   *     summary: Create a new training category
   *     tags: [TrainingCategory]
   */
  @Post("/")
  @UseBefore(canAccess("trainings", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateTrainingCategoryDto, @Res() res: any) {
    try {
      const trimmedName = data.name.trim();

      const existing = await this.categoryRepo.findOne({
        where: {
          name: { $regex: `^${trimmedName}$`, $options: "i" },
          isDeleted: false
        }
      });
      if (existing) {
        throw new BadRequestError("Training category with this name already exists");
      }

      const category = new TrainingCategory();
      category.name = trimmedName;
      category.status = data.status || category.status;
      category.isDeleted = false;

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.CREATED).json({
        message: "Training category created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/training-categories:
   *   get:
   *     summary: Get all training categories
   *     tags: [TrainingCategory]
   */
  @Get("/")
  @UseBefore(canAccess("trainings", "view"))
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
   * /api/admin/training-categories/{id}:
   *   get:
   *     summary: Get training category by ID
   *     tags: [TrainingCategory]
   */
  @Get("/:id")
  @UseBefore(canAccess("trainings", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!category) throw new NotFoundError("Training category not found");

      return res.status(StatusCodes.OK).json(category);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/training-categories/{id}:
   *   put:
   *     summary: Update a training category
   *     tags: [TrainingCategory]
   */
  @Put("/:id")
  @UseBefore(canAccess("trainings", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateTrainingCategoryDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Training category not found");

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
          throw new BadRequestError("Training category with this name already exists");
        }
        category.name = trimmedName;
      }

      if (data.status) {
        category.status = data.status;
      }

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.OK).json({
        message: "Training category updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/training-categories/{id}:
   *   delete:
   *     summary: Delete a training category
   *     tags: [TrainingCategory]
   */
  @Delete("/:id")
  @UseBefore(canAccess("trainings", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Training category not found");

      category.isDeleted = true;
      await this.categoryRepo.save(category);

      return res.status(StatusCodes.OK).json({
        message: "Training category deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
