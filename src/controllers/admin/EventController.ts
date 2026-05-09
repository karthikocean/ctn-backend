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
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Event, EventStatus } from "../../entity/Event";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateEventDto, UpdateEventDto } from "../../dto/admin/Event.dto";

@JsonController("/events")
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
  async create(@Body() data: CreateEventDto, @Res() res: any) {
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

      const saved = await this.eventRepo.save(event);
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
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
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
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const event = await this.eventRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!event) throw new NotFoundError("Event not found");

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
  async update(@Param("id") id: string, @Body() data: UpdateEventDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const event = await this.eventRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!event) throw new NotFoundError("Event not found");

      Object.assign(event, data);
      const saved = await this.eventRepo.save(event);

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
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const event = await this.eventRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!event) throw new NotFoundError("Event not found");

      event.isDeleted = true;
      await this.eventRepo.save(event);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Event deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
