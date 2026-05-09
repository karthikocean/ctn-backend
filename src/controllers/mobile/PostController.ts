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
import { PostModel as PostEntity, PostType } from "../../entity/Post";
import { Member } from "../../entity/Member";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { Category } from "../../entity/Category";
import { CreatePostDto, UpdatePostDto } from "../../dto/mobile/Post.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";

@JsonController("/posts")
@UseBefore(MobileAuthMiddleware)
export class MobilePostController {
  private postRepo = AppDataSource.getMongoRepository(PostEntity);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /mobile-api/posts:
   *   post:
   *     summary: Create a new post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreatePostDto'
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreatePostDto, @Res() res: any) {
    try {
      const userId = req.user.userId;

      const post = new PostEntity();
      Object.assign(post, data);
      post.memberId = new ObjectId(userId);
      post.isDeleted = false;

      const saved = await this.postRepo.save(post);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Post created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/my-posts:
   *   get:
   *     summary: Get posts of the logged-in member
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/my-posts")
  async getMyPosts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = req.user.userId;
      const where: any = { memberId: new ObjectId(userId), isDeleted: false };
      if (type) where.type = type;

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, posts, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/following-posts:
   *   get:
   *     summary: Get posts from members you are following
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/following-posts")
  async getFollowingPosts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = req.user.userId;

      // 1. Find who I am following
      const followings = await this.connectionRepo.find({
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
      });

      console.log(`User ${userId} is following ${followings.length} members`);

      // Ensure all IDs are fresh ObjectIds for the Mongo query
      const followingIds = followings.map(f => new ObjectId(f.receiverId));

      // // Include own posts in the feed
      // followingIds.push(new ObjectId(userId));

      // 2. Fetch posts from these members
      const where: any = {
        memberId: { $in: followingIds },
        isDeleted: false
      };

      if (type) where.type = type;

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // 3. Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // 4. Fetch Category Info for Members
      const categoryIds = [...new Set(members.map(m => m.businessCategory).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
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
   * /mobile-api/posts:
   *   get:
   *     summary: Get all posts with filters and pagination
   *     tags: [Mobile Post]
   */
  @Get("/")
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @QueryParam("memberId") memberId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (type) where.type = type;
      if (memberId && ObjectId.isValid(memberId)) where.memberId = new ObjectId(memberId);

      if (search) {
        where.$or = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } }
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
   * /mobile-api/posts/{id}:
   *   get:
   *     summary: Get post details by ID
   *     tags: [Mobile Post]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const post = await this.postRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!post) throw new NotFoundError("Post not found");

      const member = await this.memberRepo.findOneBy({ _id: post.memberId });

      const data = {
        ...post,
        member: member ? {
          _id: member._id,
          fullName: member.fullName,
          profilePhoto: member.profilePhoto,
          businessName: member.businessName
        } : null
      };

      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}:
   *   put:
   *     summary: Update an existing post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdatePostDto'
   */
  @Put("/:id")
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdatePostDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      // Only owner can update
      if (post.memberId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to update this post");
      }

      Object.assign(post, data);
      const saved = await this.postRepo.save(post);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}:
   *   delete:
   *     summary: Delete a post
   *     tags: [Mobile Post]
   */
  @Delete("/:id")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      // Only owner can delete
      if (post.memberId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to delete this post");
      }

      post.isDeleted = true;
      await this.postRepo.save(post);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
