import {
  JsonController,
  Get,
  Delete,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  Res,
  UseBefore,
  Req,
  Put,
  Body
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { PostModel as PostEntity, PostType } from "../../entity/Post";
import { Member } from "../../entity/Member";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { PostReport } from "../../entity/PostReport";
import imageService from "../../utils/upload";

@JsonController("/posts")
@UseBefore(AuthMiddleware, franchiseFilter)
export class PostController {
  private postRepo = AppDataSource.getMongoRepository(PostEntity);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private postReportRepo = AppDataSource.getMongoRepository(PostReport);

  /**
   * @swagger
   * /api/admin/posts:
   *   get:
   *     summary: Get all posts with filters and pagination
   *     tags: [Admin Post]
   *     security:
   *       - bearerAuth: []
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
   *         name: type
   *         schema: { type: string, enum: [PROMOTION, GIVE, ASK, REQUIREMENT] }
   *     responses:
   *       200:
   *         description: List of posts
   */
  @Get("/")
  @UseBefore(canAccess("posts", "view"))
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @QueryParam("status") status: string,
    @QueryParam("fromDate") fromDate: string,
    @QueryParam("toDate") toDate: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false, status: { $ne: "reported" } };

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) {
          const start = new Date(fromDate);
          start.setHours(0, 0, 0, 0);
          where.createdAt.$gte = start;
        }
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.$lte = end;
        }
      }

      if (req.isFranchise) {
        const franchiseMembers = await this.memberRepo.find({
          where: {
            businessRegion: { $in: req.franchiseAreaIds },
            isDeleted: false
          }
        });
        const franchiseMemberIds = franchiseMembers.map(m => m._id);

        if (franchiseMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }
        where.memberId = { $in: franchiseMemberIds };
      }

      if (type) {
        where.type = type;
      }

      if (status) {
        where.status = status;
      }

      if (search) {
        // Fetch matching members first to include their IDs in the post search
        const matchedMembers = await this.memberRepo.find({
          where: { fullName: { $regex: search, $options: "i" } } as any,
          select: ["_id"]
        });
        const matchedMemberIds = matchedMembers.map(m => m._id);

        where.$or = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { memberId: { $in: matchedMemberIds } }
        ];
      }

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName
      }]));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/posts/reported:
   *   get:
   *     summary: Get all reported posts with filters and pagination
   *     tags: [Admin Post]
   *     security:
   *       - bearerAuth: []
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
   *         name: type
   *         schema: { type: string, enum: [PROMOTION, GIVE, ASK, REQUIREMENT] }
   *     responses:
   *       200:
   *         description: List of reported posts
   */
  @Get("/reported")
  @UseBefore(canAccess("posts", "view"))
  async getReportedPosts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @QueryParam("fromDate") fromDate: string,
    @QueryParam("toDate") toDate: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false, status: "reported" };

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) {
          const start = new Date(fromDate);
          start.setHours(0, 0, 0, 0);
          where.createdAt.$gte = start;
        }
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.$lte = end;
        }
      }

      if (req.isFranchise) {
        const franchiseMembers = await this.memberRepo.find({
          where: {
            businessRegion: { $in: req.franchiseAreaIds },
            isDeleted: false
          }
        });
        const franchiseMemberIds = franchiseMembers.map(m => m._id);

        if (franchiseMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }
        where.memberId = { $in: franchiseMemberIds };
      }

      if (type) {
        where.type = type;
      }

      if (search) {
        const matchedMembers = await this.memberRepo.find({
          where: { fullName: { $regex: search, $options: "i" } } as any,
          select: ["_id"]
        });
        const matchedMemberIds = matchedMembers.map(m => m._id);

        where.$or = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { memberId: { $in: matchedMemberIds } }
        ];
      }

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { updatedAt: "DESC" }
      });

      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName
      }]));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/posts/{id}:
   *   get:
   *     summary: Get a single post by ID
   *     tags: [Admin Post]
   */
  @Get("/:id")
  @UseBefore(canAccess("posts", "view"))
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const post = await this.postRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!post) throw new NotFoundError("Post not found");

      const member = await this.memberRepo.findOneBy({ _id: post.memberId });

      if (req.isFranchise) {
        const regionId = member?.businessRegion;
        if (!member || !regionId || !req.franchiseAreaIds.some((areaId: ObjectId) => areaId.toString() === regionId.toString())) {
          throw new NotFoundError("Post not found");
        }
      }

      return res.status(StatusCodes.OK).json({
        ...post,
        member: member ? {
          _id: member._id,
          fullName: member.fullName,
          profilePhoto: member.profilePhoto,
          businessName: member.businessName
        } : null
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/posts/{id}:
   *   delete:
   *     summary: Delete a post
   *     tags: [Admin Post]
   */
  @Delete("/:id")
  @UseBefore(canAccess("posts", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      post.isDeleted = true;
      await this.postRepo.save(post);

      // Clean up S3 media files for this post
      if (post.media && post.media.length > 0) {
        await imageService.cleanupFiles(post.media);
      }

      return res.status(StatusCodes.OK).json({ message: "Post deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/posts/{id}/status:
   *   put:
   *     summary: Update post status and reason
   *     tags: [Admin Post]
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               status:
   *                 type: string
   *               reason:
   *                 type: string
   */
  @Put("/:id/status")
  @UseBefore(canAccess("posts", "update"))
  async updateStatus(
    @Param("id") id: string,
    @Body() body: { status: string; reason?: string },
    @Req() req: any,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      post.status = body.status;
      if (body.reason) {
        post.statusReason = body.reason;
      } else {
        post.statusReason = "";
      }

      await this.postRepo.save(post);
      const history = new PostReport();
      history.postId = post._id;
      history.reporterId = new ObjectId(req.user.userId);
      history.reason = body.reason ?? "";
      await this.postReportRepo.save(history);
      return res.status(StatusCodes.OK).json({ message: "Post status updated successfully", post });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
