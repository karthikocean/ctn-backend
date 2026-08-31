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
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Training } from "../../entity/Training";
import { TrainingCategory } from "../../entity/TrainingCategory";
import { CreateTrainingDto, UpdateTrainingDto } from "../../dto/admin/Training.dto";
import { notifyAllActiveMembers } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import imageService from "../../utils/upload";

@JsonController("/trainings")
@UseBefore(AuthMiddleware)
export class TrainingController {
  private trainingRepo = AppDataSource.getMongoRepository(Training);

  /**
   * @swagger
   * /api/admin/trainings:
   *   post:
   *     summary: Create a new training course
   *     tags: [Training]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateTrainingDto'
   *     responses:
   *       201:
   *         description: Training created successfully
   */
  @Post("/")
  @UseBefore(canAccess("trainings", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreateTrainingDto, @Res() res: any) {
    try {
      const training = new Training();
      Object.assign(training, data);
      training.isDeleted = false;

      if (data.categoryId) {
        if (!ObjectId.isValid(data.categoryId)) {
          throw new BadRequestError("Invalid categoryId");
        }
        training.categoryId = new ObjectId(data.categoryId);
      }

      // ✅ Generate ObjectIds for lessons
      if (training.lessons) {
        training.lessons = training.lessons.map(lesson => ({
          ...lesson,
          _id: lesson._id ? new ObjectId(lesson._id) : new ObjectId()
        }));
      }

      const saved = await this.trainingRepo.save(training);

      // Send push notification to all active members
      await notifyAllActiveMembers({
        subject: "New Training Available",
        content: `Trusted Network has introduced a new ${training.title} program. Explore the details and register.`,
        moduleName: NotificationModule.TRAINING,
        moduleId: saved._id.toString(),
        senderId: req.user.userId
      });

      return res.status(StatusCodes.CREATED).json({
        message: "Training course published successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/trainings:
   *   get:
   *     summary: Get all training courses with pagination and search
   *     tags: [Training]
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
   *         name: status
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: List of training courses
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
        where.$or = [
          { title: { $regex: search, $options: "i" } },
          { authorName: { $regex: search, $options: "i" } }
        ];
      }

      if (status) {
        where.status = status;
      }

      const [trainings, total] = await this.trainingRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Populate TrainingCategory details
      const categoryRepo = AppDataSource.getMongoRepository(TrainingCategory);
      const categoryIds = trainings
        .map(t => t.categoryId)
        .filter((id): id is ObjectId => !!id);

      const categories = categoryIds.length > 0
        ? await categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c]));

      const populated = trainings.map(t => ({
        ...t,
        category: t.categoryId ? categoryMap.get(t.categoryId.toString()) || null : null
      }));

      return pagination(total, populated, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/trainings/{id}:
   *   get:
   *     summary: Get a single training course by ID
   *     tags: [Training]
   */
  @Get("/:id")
  @UseBefore(canAccess("trainings", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const training = await this.trainingRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!training) throw new NotFoundError("Training course not found");

      let category = null;
      if (training.categoryId) {
        const categoryRepo = AppDataSource.getMongoRepository(TrainingCategory);
        category = await categoryRepo.findOneBy({ _id: training.categoryId, isDeleted: false });
      }

      return res.status(StatusCodes.OK).json({
        ...training,
        category
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/trainings/{id}:
   *   put:
   *     summary: Update a training course
   *     tags: [Training]
   */
  @Put("/:id")
  @UseBefore(canAccess("trainings", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateTrainingDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const training = await this.trainingRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!training) throw new NotFoundError("Training course not found");

      const oldThumbnail = training.thumbnail;
      const oldBanner = training.banner;
      const oldAuthorImage = training.authorImage;
      const oldLessonFiles = (training.lessons || []).flatMap((l) => [l.videoUrl, l.thumbnail]).filter(Boolean);

      Object.assign(training, data);

      if (data.categoryId !== undefined) {
        if (data.categoryId) {
          if (!ObjectId.isValid(data.categoryId)) {
            throw new BadRequestError("Invalid categoryId");
          }
          training.categoryId = new ObjectId(data.categoryId);
        } else {
          training.categoryId = undefined;
        }
      }

      // ✅ Ensure each lesson has an _id (persistent or new)
      if (training.lessons) {
        training.lessons = training.lessons.map(lesson => ({
          ...lesson,
          _id: lesson._id ? new ObjectId(lesson._id) : new ObjectId()
        }));
      }

      const saved = await this.trainingRepo.save(training);

      // Clean up replaced S3 media files
      if (data.thumbnail !== undefined) {
        imageService.cleanupReplacedFiles(oldThumbnail, data.thumbnail);
      }
      if (data.banner !== undefined) {
        imageService.cleanupReplacedFiles(oldBanner, data.banner);
      }
      if (data.authorImage !== undefined) {
        imageService.cleanupReplacedFiles(oldAuthorImage, data.authorImage);
      }
      if (data.lessons !== undefined) {
        const newLessonFiles = (data.lessons || []).flatMap((l: any) => [l.videoUrl, l.thumbnail]).filter(Boolean);
        imageService.cleanupReplacedFiles(oldLessonFiles, newLessonFiles);
      }

      return res.status(StatusCodes.OK).json({
        message: "Training course updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/trainings/{id}:
   *   delete:
   *     summary: Delete a training course (Soft Delete)
   *     tags: [Training]
   */
  @Delete("/:id")
  @UseBefore(canAccess("trainings", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const training = await this.trainingRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!training) throw new NotFoundError("Training course not found");

      training.isDeleted = true;
      await this.trainingRepo.save(training);

      // Clean up all S3 media files for this training
      const allFiles = [
        training.thumbnail,
        training.banner,
        training.authorImage,
        ...(training.lessons || []).flatMap((l) => [l.videoUrl, l.thumbnail])
      ].filter(Boolean);
      await imageService.cleanupFiles(allFiles);

      return res.status(StatusCodes.OK).json({ message: "Training course deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
