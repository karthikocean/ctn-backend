import {
  JsonController,
  Get,
  Param,
  QueryParam,
  Res,
  NotFoundError,
  BadRequestError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Announcement, AnnouncementStatus } from "../../entity/Announcement";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

/**
 * @swagger
 * tags:
 *   name: Website Announcements
 *   description: Public website announcement APIs
 */

@JsonController("/announcements")
export class WebsiteAnnouncementController {
  private announcementRepo = AppDataSource.getMongoRepository(Announcement);

  /**
   * @swagger
   * /website-api/announcements:
   *   get:
   *     summary: Get published announcements for website display
   *     tags: [Website Announcements]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page index (0-based)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Number of items per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Optional search query for title, content, or location
   *       - in: query
   *         name: announcementType
   *         schema:
   *           type: string
   *           enum: [Event, Online Stall, Others, Training]
   *         description: Optional filter by announcement type
   *     responses:
   *       200:
   *         description: List of published announcements retrieved successfully
   */
  @Get("/")
  async getWebsiteAnnouncements(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("announcementType") announcementType: string,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        isDeleted: false,
        status: AnnouncementStatus.PUBLISHED
      };

      if (announcementType && announcementType.trim() !== "") {
        where.announcementType = announcementType.trim();
      }

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { title: regex },
          { content: regex },
          { location: regex }
        ];
      }

      const [announcements, total] = await this.announcementRepo.findAndCount({
        where,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      return pagination(total, announcements, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/announcements/{id}:
   *   get:
   *     summary: Get single published announcement details by ID
   *     tags: [Website Announcements]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Announcement ObjectId
   *     responses:
   *       200:
   *         description: Announcement details retrieved successfully
   *       404:
   *         description: Announcement not found
   */
  @Get("/:id")
  async getAnnouncementById(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Announcement ID");
      }

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false,
        status: AnnouncementStatus.PUBLISHED
      });

      if (!announcement) {
        throw new NotFoundError("Announcement not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Announcement retrieved successfully",
        data: announcement
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
