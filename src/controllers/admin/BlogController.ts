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
import { Blog, BlogStatus } from "../../entity/Blog";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateBlogDto, UpdateBlogDto } from "../../dto/admin/Blog.dto";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";

@JsonController("/blogs")
@UseBefore(AuthMiddleware, franchiseFilter)
export class AdminBlogController {
  private blogRepo = AppDataSource.getMongoRepository(Blog);

  /**
   * @swagger
   * /api/admin/blogs:
   *   post:
   *     summary: Create a new blog (Admin)
   *     tags: [Admin Blog]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreateBlogDto, @Res() res: any) {
    try {
      // Check for unique title
      const existingTitle = await this.blogRepo.findOneBy({
        title: data.title,
        isDeleted: false
      });
      if (existingTitle) throw new BadRequestError("A blog with this title already exists");

      // Check for unique slug
      const existingSlug = await this.blogRepo.findOneBy({
        slug: data.slug,
        isDeleted: false
      });
      if (existingSlug) throw new BadRequestError("A blog with this slug already exists");

      const blog = new Blog();
      Object.assign(blog, data);

      blog.isDeleted = false;
      blog.status = data.status || BlogStatus.ACTIVE;
      blog.createdBy = new ObjectId(req.user.userId);
      blog.updatedBy = new ObjectId(req.user.userId);

      const saved = await this.blogRepo.save(blog);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Blog created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/blogs:
   *   get:
   *     summary: List all blogs (Admin)
   *     tags: [Admin Blog]
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

      const [blogs, total] = await this.blogRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { publishDate: "DESC", createdAt: "DESC" }
      });

      return pagination(total, blogs, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/blogs/{id}:
   *   get:
   *     summary: Get single blog details
   *     tags: [Admin Blog]
   */
  @Get("/:id")
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const blog = await this.blogRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!blog) throw new NotFoundError("Blog not found");

      if (req.isFranchise) {
        if (!blog.createdBy || blog.createdBy.toString() !== req.user.userId) {
          throw new NotFoundError("Blog not found");
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: blog
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/blogs/{id}:
   *   put:
   *     summary: Update blog
   *     tags: [Admin Blog]
   */
  @Put("/:id")
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdateBlogDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const blog = await this.blogRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!blog) throw new NotFoundError("Blog not found");

      if (req.isFranchise) {
        if (!blog.createdBy || blog.createdBy.toString() !== req.user.userId) {
          throw new BadRequestError("You are not authorized to update this blog");
        }
      }

      const title = data.title || blog.title;
      const slug = data.slug || blog.slug;

      // Check unique title if changed
      if (data.title && data.title !== blog.title) {
        const existingTitle = await this.blogRepo.findOne({
          where: {
            title: title,
            _id: { $ne: new ObjectId(id) },
            isDeleted: false
          }
        });
        if (existingTitle) throw new BadRequestError("A blog with this title already exists");
      }

      // Check unique slug if changed
      if (data.slug && data.slug !== blog.slug) {
        const existingSlug = await this.blogRepo.findOne({
          where: {
            slug: slug,
            _id: { $ne: new ObjectId(id) },
            isDeleted: false
          }
        });
        if (existingSlug) throw new BadRequestError("A blog with this slug already exists");
      }

      Object.assign(blog, data);
      blog.updatedBy = new ObjectId(req.user.userId);
      const saved = await this.blogRepo.save(blog);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Blog updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/blogs/{id}:
   *   delete:
   *     summary: Soft delete blog
   *     tags: [Admin Blog]
   */
  @Delete("/:id")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const blog = await this.blogRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!blog) throw new NotFoundError("Blog not found");

      if (req.isFranchise) {
        if (!blog.createdBy || blog.createdBy.toString() !== req.user.userId) {
          throw new BadRequestError("You are not authorized to delete this blog");
        }
      }

      blog.isDeleted = true;
      blog.updatedBy = new ObjectId(req.user.userId);
      await this.blogRepo.save(blog);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Blog deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
