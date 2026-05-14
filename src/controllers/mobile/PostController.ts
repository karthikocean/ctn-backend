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
import { Conversation } from "../../entity/Conversation";
import { Message, MessageType } from "../../entity/Message";
import { SavedPost } from "../../entity/SavedPost";
import { CreatePostDto, UpdatePostDto } from "../../dto/mobile/Post.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { getIO, isUserInConversation } from "../../utils/socket";

@JsonController("/posts")
@UseBefore(MobileAuthMiddleware)
export class MobilePostController {
  private postRepo = AppDataSource.getMongoRepository(PostEntity);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private conversationRepo = AppDataSource.getMongoRepository(Conversation);
  private messageRepo = AppDataSource.getMongoRepository(Message);
  private savedPostRepo = AppDataSource.getMongoRepository(SavedPost);

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
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, REQUIREMENT, GIVE, ASK]
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
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, REQUIREMENT, GIVE, ASK]
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

      // 5. Check which posts are saved by current user
      const savedPosts = await this.savedPostRepo.find({
        where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      });
      const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: savedPostIds.has(p._id.toString())
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
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, REQUIREMENT, GIVE, ASK]
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: memberId
   *         schema:
   *           type: string
   */
  @Get("/")
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @QueryParam("memberId") memberId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    const userId = req.user.userId;

    try {
      const where: any = { isDeleted: false };

      if (type) where.type = type;

      // Special logic for GIVE posts: Only show from mutual friends
      if (type === PostType.GIVE) {
        // 1. Find who current user follows
        const following = await this.connectionRepo.find({
          where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        const followingIds = following.map(f => f.receiverId.toString());

        // 2. Find who follows current user
        const followers = await this.connectionRepo.find({
          where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        const followerIds = followers.map(f => f.senderId.toString());

        // 3. Mutual = Intersection
        const mutualIds = followingIds
          .filter(id => followerIds.includes(id))
          .map(id => new ObjectId(id));

        // If no mutual friends, return empty list (or maybe show own posts too?)
        // The user said "only mutual friends posts"
        where.memberId = { $in: mutualIds };
      } else if (memberId && ObjectId.isValid(memberId)) {
        where.memberId = new ObjectId(memberId);
      }

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

      // Check which posts are saved by current user
      const savedPosts = await this.savedPostRepo.find({
        where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      });
      const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: savedPostIds.has(p._id.toString())
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
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/:id")
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const post = await this.postRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!post) throw new NotFoundError("Post not found");

      const member = await this.memberRepo.findOneBy({ _id: post.memberId });

      // Check if saved
      const isSaved = !!(await this.savedPostRepo.findOneBy({
        memberId: new ObjectId(userId),
        postId: post._id
      }));

      const data = {
        ...post,
        member: member ? {
          _id: member._id,
          fullName: member.fullName,
          profilePhoto: member.profilePhoto,
          businessName: member.businessName
        } : null,
        isSaved
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
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
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

  /**
   * @swagger
   * /mobile-api/posts/{id}/share:
   *   post:
   *     summary: Increment sharedCount of a post
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
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               receiverId:
   *                 type: string
   */
  @Post("/:id/share")
  async share(@Req() req: any, @Param("id") id: string, @Body() body: { receiverId: string }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const { receiverId } = body;

      if (!receiverId || !ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid or missing receiverId");
      }

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      // Increment share count
      post.sharedCount = (post.sharedCount || 0) + 1;
      await this.postRepo.save(post);

      const recId = new ObjectId(receiverId);
      // Find or Create conversation between userId and receiverId
      let targetConversation = await this.conversationRepo.findOne({
        where: {
          participants: { $all: [userId, recId] },
          postId: { $exists: false } // General chat
        } as any
      });

      if (!targetConversation) {
        targetConversation = new Conversation();
        targetConversation.participants = [userId, recId];
        targetConversation.status = "";
        targetConversation = await this.conversationRepo.save(targetConversation);
      } else {
        // Check if already shared in this conversation by this user
        const existingShare = await this.messageRepo.findOne({
          where: {
            conversationId: targetConversation._id,
            senderId: userId,
            type: MessageType.POST_SHARE,
            postId: post._id
          } as any
        });

        if (existingShare) {
          return res.status(StatusCodes.OK).json({
            success: true,
            message: "You have already shared this post with this member",
            sharedCount: post.sharedCount,
            conversationId: targetConversation._id,
            existingShare
          });
        }
      }

      // If targetConversation is found or created, send the post into the chat
      if (targetConversation) {
        const otherId = targetConversation.participants.find(p => !p.equals(userId));
        if (!otherId) throw new BadRequestError("No receiver found in this conversation");

        const newMessage = new Message();
        newMessage.conversationId = targetConversation._id;
        newMessage.senderId = userId;
        newMessage.content = "Shared a post";
        newMessage.type = MessageType.POST_SHARE;
        newMessage.postId = post._id;

        // Check if receiver is in the chat room
        const isReceiverActive = isUserInConversation(otherId.toString(), targetConversation._id.toString());
        if (isReceiverActive) {
          newMessage.isRead = true;
        }

        await this.messageRepo.save(newMessage);

        // Update conversation last message and unread count
        targetConversation.lastMessage = "Shared a post";
        targetConversation.lastMessageTime = new Date();
        targetConversation.lastMessageSenderId = userId;

        // Update unread count for receiver
        const unreadCounts = targetConversation.unreadCounts || {};
        if (isReceiverActive) {
          unreadCounts[otherId.toString()] = 0;
        } else {
          unreadCounts[otherId.toString()] = (unreadCounts[otherId.toString()] || 0) + 1;
        }
        targetConversation.unreadCounts = { ...unreadCounts };

        await this.conversationRepo.save(targetConversation);

        // Socket Notification
        if (otherId) {
          const io = getIO();
          const populatedMessage = {
            ...newMessage,
            isMe: false,
            post: post
          };
          io.to(otherId.toString()).emit("new_message", populatedMessage);
          // Emit conversation update for the conversation list screen
          const sender = await this.memberRepo.findOneBy({ _id: userId });
          let senderCategoryName = null;
          if (sender && sender.businessCategory) {
            const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
            senderCategoryName = cat ? cat.name : null;
          }

          const unreadCount = targetConversation.unreadCounts?.[otherId.toString()] || 0;

          io.to(otherId.toString()).emit("conversation_updated", {
            ...targetConversation,
            lastMessage: "Shared a post",
            lastMessageTime: targetConversation.lastMessageTime,
            lastMessageSenderId: userId,
            otherUser: sender ? {
              _id: sender._id,
              fullName: sender.fullName,
              profilePhoto: sender.profilePhoto,
              categoryName: senderCategoryName
            } : null,
            post: post,
            unreadCount
          });
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post shared successfully",
        sharedCount: post.sharedCount,
        conversationId: targetConversation?._id
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}/save:
   *   post:
   *     summary: Save a post to bookmarks
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Post("/:id/save")
  async savePost(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const postId = new ObjectId(id);

      const post = await this.postRepo.findOneBy({ _id: postId, isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      const existing = await this.savedPostRepo.findOneBy({ memberId: userId, postId });
      if (existing) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Post already saved"
        });
      }

      const savedPost = new SavedPost();
      savedPost.memberId = userId;
      savedPost.postId = postId;
      await this.savedPostRepo.save(savedPost);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post saved to bookmarks"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}/unsave:
   *   post:
   *     summary: Remove a post from bookmarks
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Post("/:id/unsave")
  async unsavePost(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const postId = new ObjectId(id);

      await this.savedPostRepo.deleteMany({ memberId: userId, postId });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post removed from bookmarks"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/saved/list:
   *   get:
   *     summary: Get all saved posts of the logged-in member
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/saved/list")
  async getSavedPosts(@Req() req: any, @QueryParam("page") page: number, @QueryParam("limit") limit: number, @Res() res: any) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = new ObjectId(req.user.userId);

      const [savedEntries, total] = await this.savedPostRepo.findAndCount({
        where: { memberId: userId },
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      const postIds = savedEntries.map(s => s.postId);
      const posts = postIds.length > 0
        ? await this.postRepo.find({ where: { _id: { $in: postIds }, isDeleted: false } as any })
        : [];

      // Populate Member Info for the posts
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
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: true
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
