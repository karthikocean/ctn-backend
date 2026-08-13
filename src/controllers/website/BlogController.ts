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
import { Blog, BlogStatus } from "../../entity/Blog";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

/**
 * @swagger
 * tags:
 *   name: Website Blogs
 *   description: Public website blog list and detail APIs
 */

@JsonController("/blogs")
export class WebsiteBlogController {
  private blogRepo = AppDataSource.getMongoRepository(Blog);

  /**
   * @swagger
   * /website-api/blogs:
   *   get:
   *     summary: Get published website blogs with pagination and search
   *     tags: [Website Blogs]
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
   *         description: Search query for blog title, short description, or meta keywords
   *     responses:
   *       200:
   *         description: List of published website blogs retrieved successfully
   */
  @Get("/")
  async getWebsiteBlogs(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        isDeleted: false,
        status: BlogStatus.ACTIVE
      };

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { title: regex },
          { shortDescription: regex },
          { metaKeywords: regex }
        ];
      }

      const [blogs, total] = await this.blogRepo.findAndCount({
        where,
        order: { publishDate: "DESC", createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      return pagination(total, blogs, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/blogs/{slugOrId}:
   *   get:
   *     summary: Get single published website blog by slug or ID
   *     tags: [Website Blogs]
   *     parameters:
   *       - in: path
   *         name: slugOrId
   *         required: true
   *         schema:
   *           type: string
   *         description: Blog slug or ObjectId
   *     responses:
   *       200:
   *         description: Blog details retrieved successfully
   *       404:
   *         description: Blog not found
   */
  @Get("/:slugOrId")
  async getBlogBySlugOrId(@Param("slugOrId") slugOrId: string, @Res() res: any) {
    try {
      if (!slugOrId || !slugOrId.trim()) {
        throw new BadRequestError("Blog slug or ID is required");
      }

      const identifier = slugOrId.trim();

      const whereConditions: any[] = [
        { slug: identifier, isDeleted: false, status: BlogStatus.ACTIVE }
      ];

      if (ObjectId.isValid(identifier)) {
        whereConditions.push({
          _id: new ObjectId(identifier),
          isDeleted: false,
          status: BlogStatus.ACTIVE
        });
      }

      const blog = await this.blogRepo.findOne({
        where: { $or: whereConditions } as any
      });

      if (!blog) {
        throw new NotFoundError("Blog not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Blog retrieved successfully",
        data: blog
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
