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
import { Event, EventStatus } from "../../entity/Event";
import { notifyAllActiveMembers } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateEventDto, UpdateEventDto } from "../../dto/admin/Event.dto";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import imageService from "../../utils/upload";

@JsonController("/events")
@UseBefore(AuthMiddleware, franchiseFilter)
export class AdminEventController {
  private eventRepo = AppDataSource.getMongoRepository(Event);

  /**
   * @swagger
   * /api/admin/events:
   *   post:
   *     summary: Create a new event (Admin)
   *     tags: [Admin Event]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreateEventDto, @Res() res: any) {
    try {
      // ✅ Check for unique title
      const existing = await this.eventRepo.findOneBy({
        title: data.title,
        isDeleted: false
      });
      if (existing) throw new BadRequestError("An event with this title already exists");

      const event = new Event();
      Object.assign(event, data);

      event.isDeleted = false;
      event.status = data.status || EventStatus.UPCOMING;
      event.createdBy = new ObjectId(req.user.userId);
      event.updatedBy = new ObjectId(req.user.userId);

      const saved = await this.eventRepo.save(event);

      // Send push notification to all active members
      await notifyAllActiveMembers({
        subject: "New Event Created! 🗓️",
        content: `Check out the new event: ${event.title}`,
        moduleName: NotificationModule.EVENT,
        moduleId: saved._id.toString(),
        senderId: req.user.userId
      });

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Event created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/events:
   *   get:
   *     summary: List all events (Admin)
   *     tags: [Admin Event]
   */
  @Get("/")
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (req.isFranchise) {
        where.createdBy = new ObjectId(req.user.userId);
      }
      if (search) {
        where.title = { $regex: search, $options: "i" };
      }

      const [events, total] = await this.eventRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, events, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/events/{id}:
   *   get:
   *     summary: Get single event details
   *     tags: [Admin Event]
   */
  @Get("/:id")
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const event = await this.eventRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!event) throw new NotFoundError("Event not found");

      if (req.isFranchise) {
        if (!event.createdBy || event.createdBy.toString() !== req.user.userId) {
          throw new NotFoundError("Event not found");
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: event
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/events/{id}:
   *   put:
   *     summary: Update event
   *     tags: [Admin Event]
   */
  @Put("/:id")
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdateEventDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const event = await this.eventRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!event) throw new NotFoundError("Event not found");

      if (req.isFranchise) {
        if (!event.createdBy || event.createdBy.toString() !== req.user.userId) {
          throw new BadRequestError("You are not authorized to update this event");
        }
      }

      const oldImage = event.image;
      const oldVideo = event.video;

      Object.assign(event, data);
      event.updatedBy = new ObjectId(req.user.userId);
      const saved = await this.eventRepo.save(event);

      // Clean up replaced S3 files
      if (data.image !== undefined) {
        imageService.cleanupReplacedFiles(oldImage, data.image);
      }
      if (data.video !== undefined) {
        imageService.cleanupReplacedFiles(oldVideo, data.video);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Event updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/events/{id}:
   *   delete:
   *     summary: Soft delete event
   *     tags: [Admin Event]
   */
  @Delete("/:id")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const event = await this.eventRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!event) throw new NotFoundError("Event not found");

      if (req.isFranchise) {
        if (!event.createdBy || event.createdBy.toString() !== req.user.userId) {
          throw new BadRequestError("You are not authorized to delete this event");
        }
      }

      event.isDeleted = true;
      event.updatedBy = new ObjectId(req.user.userId);
      await this.eventRepo.save(event);

      // Clean up S3 image and video
      await imageService.cleanupFiles([event.image, event.video].filter(Boolean));

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Event deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
