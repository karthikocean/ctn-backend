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
import { Announcement, AnnouncementStatus } from "../../entity/Announcement";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/announcements")
export class AdminAnnouncementController {
  private announcementRepo = AppDataSource.getMongoRepository(Announcement);

  /**
   * @swagger
   * /api/admin/announcements:
   *   post:
   *     summary: Create a new announcement (Admin)
   *     tags: [Admin Announcement]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: any, @Res() res: any) {
    try {
      // ✅ Mandatory Validations
      if (!data.title) throw new BadRequestError("Title is required");
      if (!data.content) throw new BadRequestError("Content is required");

      const announcement = new Announcement();
      Object.assign(announcement, data);

      announcement.isDeleted = false;
      announcement.status = data.status || AnnouncementStatus.DRAFT;

      const saved = await this.announcementRepo.save(announcement);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Announcement created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements:
   *   get:
   *     summary: List all announcements (Admin)
   *     tags: [Admin Announcement]
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

      const [announcements, total] = await this.announcementRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, announcements, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}:
   *   get:
   *     summary: Get single announcement details
   *     tags: [Admin Announcement]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      return res.status(StatusCodes.OK).json({
        success: true,
        data: announcement
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}:
   *   put:
   *     summary: Update announcement
   *     tags: [Admin Announcement]
   */
  @Put("/:id")
  async update(@Param("id") id: string, @Body() data: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      Object.assign(announcement, data);
      const saved = await this.announcementRepo.save(announcement);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Announcement updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}:
   *   delete:
   *     summary: Soft delete announcement
   *     tags: [Admin Announcement]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      announcement.isDeleted = true;
      await this.announcementRepo.save(announcement);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Announcement deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
