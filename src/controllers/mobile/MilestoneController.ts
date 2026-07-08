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
import { Milestone } from "../../entity/Milestone";
import { MilestoneView } from "../../entity/MilestoneView";
import { Member } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { Conversation } from "../../entity/Conversation";
import { Message, MessageType } from "../../entity/Message";
import { CreateMilestoneDto, UpdateMilestoneDto } from "../../dto/mobile/Milestone.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { pagination } from "../../utils";
import { getIO, isUserInConversation } from "../../utils/socket";
import { validateModuleUsage } from "../../services/moduleUsage.service";
import { PointService } from "../../services/point.service";
import { PointConfigType } from "../../entity/PointConfig";
import { DailyScoreService } from "../../services/dailyScore.service";

@JsonController("/milestones")
@UseBefore(MobileAuthMiddleware)
export class MobileMilestoneController {
  private milestoneRepo = AppDataSource.getMongoRepository(Milestone);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private conversationRepo = AppDataSource.getMongoRepository(Conversation);
  private messageRepo = AppDataSource.getMongoRepository(Message);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /mobile-api/milestones:
   *   post:
   *     summary: Create a new milestone
   *     tags: [Mobile Milestone]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateMilestoneDto'
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreateMilestoneDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const memberObjectId = new ObjectId(userId);

      // 1. Validate module usage limit before saving the document
      await validateModuleUsage(memberObjectId, "Milestones");

      const milestone = new Milestone();
      Object.assign(milestone, data);
      milestone.memberId = memberObjectId;
      milestone.viewCount = 0;
      milestone.clapsCount = 0;
      milestone.isDeleted = false;
      // Expire after 48 hours
      milestone.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const saved = await this.milestoneRepo.save(milestone);

      let pointsResult = { awarded: 0, balance: 0 };
      // 2. Award Points
      try {
        const pointService = new PointService();
        pointsResult = await pointService.awardPoints({
          memberId: memberObjectId,
          moduleName: "Milestones",
          type: PointConfigType.CREATION,
          referenceId: saved._id
        });
      } catch (pointError) {
        console.error("Failed to award points for milestone creation:", pointError);
      }

      // 2.5 Award Daily Score Checklist Points
      try {
        const dailyScoreService = new DailyScoreService();
        await dailyScoreService.awardDailyScore(
          memberObjectId,
          "Milestone",
          saved._id
        );
      } catch (dailyScoreError) {
        console.error("Failed to award daily score for milestone creation:", dailyScoreError);
      }

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Milestone created successfully",
        data: saved,
        points: pointsResult
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones:
   *   get:
   *     summary: Get milestones from members you are following (grouped by member)
   *     tags: [Mobile Milestone]
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
  @Get("/")
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
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

      const followingIds = followings.map(f => new ObjectId(f.receiverId));

      // 2. Find active milestones from these members
      const milestones = await this.milestoneRepo.find({
        where: {
          memberId: { $in: followingIds },
          isDeleted: false,
          isActive: true,
          expiresAt: { $gt: new Date() }
        } as any,
        order: {
          createdAt: "DESC"
        }
      });

      // 3. Group by memberId
      const grouped = new Map<string, Milestone[]>();
      milestones.forEach(m => {
        const mid = m.memberId.toString();
        if (!grouped.has(mid)) grouped.set(mid, []);
        grouped.get(mid)?.push(m);
      });

      const memberIds = Array.from(grouped.keys()).map(id => new ObjectId(id));
      const members = await this.memberRepo.find({
        where: { _id: { $in: memberIds } } as any
      });

      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      // 4. Identify which groups are fully "watched"
      const allMilestoneIds = milestones.map(m => m._id);
      const myViews = await this.milestoneViewRepo.find({
        where: { milestoneId: { $in: allMilestoneIds }, viewerId: new ObjectId(userId) } as any
      });
      const viewedMilestoneIds = new Set(myViews.map(v => v.milestoneId.toString()));

      const result = Array.from(grouped.entries()).map(([mid, ms]) => {
        const member = memberMap.get(mid);
        const allWatched = ms.every(m => viewedMilestoneIds.has(m._id.toString()));

        return {
          _id: mid,
          fullName: member?.fullName || "",
          profilePhoto: member?.profilePhoto || "",
          businessName: member?.businessName || "",
          milestones: ms,
          isMe: mid === userId,
          allWatched
        };
      });

      // 5. Sort:
      // Priority 1: Unwatched groups first
      // Priority 2: Watched groups last
      // Within groups, sort by latest milestone creation
      result.sort((a, b) => {
        // If one is watched and other is not
        if (!a.allWatched && b.allWatched) return -1;
        if (a.allWatched && !b.allWatched) return 1;

        // Otherwise sort by latest milestone date
        const aLatest = a.milestones[0].createdAt.getTime();
        const bLatest = b.milestones[0].createdAt.getTime();
        return bLatest - aLatest;
      });

      // 6. Paginate the grouped results
      const total = result.length;
      const paginatedData = result.slice(page * limit, (page + 1) * limit);

      return pagination(total, paginatedData, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones/my-milestones:
   *   get:
   *     summary: Get milestones of the logged-in member
   *     tags: [Mobile Milestone]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/my-milestones")
  async getMyMilestones(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const milestones = await this.milestoneRepo.find({
        where: { memberId: new ObjectId(userId), isDeleted: false },
        order: { createdAt: "DESC" }
      });

      if (milestones.length === 0) {
        return res.status(StatusCodes.OK).json({ success: true, data: [] });
      }

      // Fetch all views for these milestones
      const milestoneIds = milestones.map(m => m._id);
      const views = await this.milestoneViewRepo.find({
        where: { milestoneId: { $in: milestoneIds } } as any
      });

      // Group views by milestoneId
      const viewsMap = new Map<string, any[]>();
      views.forEach(v => {
        const mid = v.milestoneId.toString();
        if (!viewsMap.has(mid)) viewsMap.set(mid, []);
        viewsMap.get(mid)?.push({ viewerId: v.viewerId, reacted: v.reacted });
      });

      // Get all unique viewer IDs
      const viewerIds = [...new Set(views.map(v => v.viewerId))];
      const viewers = viewerIds.length > 0
        ? await this.memberRepo.find({
          where: { _id: { $in: viewerIds } } as any
        })
        : [];

      // Fetch categories for these viewers
      const categoryIds = viewers
        .map(v => v.businessCategory)
        .filter((id): id is ObjectId => !!id);

      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const viewerMap = new Map(viewers.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
      }]));

      const data = milestones.map(m => {
        const vData = viewsMap.get(m._id.toString()) || [];
        return {
          ...m,
          viewers: vData.map(vd => {
            const profile = viewerMap.get(vd.viewerId.toString());
            return profile ? { ...profile, reacted: vd.reacted || false } : null;
          }).filter(v => !!v)
        };
      });

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
   * /mobile-api/milestones/member/{memberId}:
   *   get:
   *     summary: Get milestones of a specific member
   *     tags: [Mobile Milestone]
   *     parameters:
   *       - in: path
   *         name: memberId
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/member/:memberId")
  async getByMember(@Param("memberId") memberId: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(memberId)) throw new BadRequestError("Invalid Member ID");

      const milestones = await this.milestoneRepo.find({
        where: { memberId: new ObjectId(memberId), isDeleted: false },
        order: { createdAt: "DESC" }
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: milestones
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones/{id}/reply:
   *   post:
   *     summary: Reply to a milestone to initiate a chat
   *     tags: [Mobile Milestone]
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
   *             type: object
   *             properties:
   *               content:
   *                 type: string
   *                 example: "Congratulations on your success!"
   */
  @Post("/:id/reply")
  async reply(@Req() req: any, @Param("id") id: string, @Body() body: { content: string }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid Milestone ID");
      const userId = new ObjectId(req.user.userId);
      const milestoneId = new ObjectId(id);
      const { content } = body;

      if (!content) throw new BadRequestError("Reply content is required");

      const milestone = await this.milestoneRepo.findOneBy({ _id: milestoneId });
      if (!milestone) throw new NotFoundError("Milestone not found");

      const ownerId = milestone.memberId;
      if (ownerId.equals(userId)) {
        throw new BadRequestError("You cannot reply to your own milestone");
      }

      // 1. Find or Create Conversation
      let conversation = await this.conversationRepo.findOne({
        where: {
          participants: { $all: [userId, ownerId] },
          milestoneId: milestoneId
        } as any
      });

      if (!conversation) {
        conversation = new Conversation();
        conversation.participants = [userId, ownerId];
        conversation.milestoneId = milestoneId;
        conversation.status = "PENDING";
        conversation = await this.conversationRepo.save(conversation);
      }

      // 2. Create Message
      const message = new Message();
      message.conversationId = conversation._id;
      message.senderId = userId;
      message.content = content;
      message.type = MessageType.MILESTONE_REPLY;
      message.milestoneId = milestoneId;

      // Check if receiver is in the chat room
      const isReceiverActive = isUserInConversation(ownerId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        message.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(message);

      // 3. Update Conversation
      conversation.lastMessage = content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = userId;

      // Update unread count for receiver
      const unreadCounts = conversation.unreadCounts || {};
      if (isReceiverActive) {
        unreadCounts[ownerId.toString()] = 0;
      } else {
        unreadCounts[ownerId.toString()] = (unreadCounts[ownerId.toString()] || 0) + 1;
      }
      conversation.unreadCounts = { ...unreadCounts };

      await this.conversationRepo.save(conversation);

      // 4. Socket Notification
      const io = getIO();
      const populatedMessage = {
        ...savedMessage,
        isMe: false,
        milestone: milestone
      };

      // Emit to the owner
      const sender = await this.memberRepo.findOneBy({ _id: userId });
      let senderCategoryName = null;
      if (sender && sender.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
        senderCategoryName = cat ? cat.name : null;
      }

      const unreadCount = conversation.unreadCounts?.[ownerId.toString()] || 0;

      io.to(ownerId.toString()).emit("new_message", populatedMessage);
      io.to(ownerId.toString()).emit("conversation_updated", {
        ...conversation,
        lastMessage: content,
        lastMessageTime: conversation.lastMessageTime,
        lastMessageSenderId: userId,
        otherUser: sender ? {
          _id: sender._id,
          fullName: sender.fullName,
          profilePhoto: sender.profilePhoto,
          categoryName: senderCategoryName
        } : null,
        milestone: milestone,
        unreadCount
      });

      let pointsResult = { awarded: 0, balance: 0 };
      try {
        const pointService = new PointService();
        pointsResult = await pointService.awardPoints({
          memberId: userId,
          moduleName: "Milestones",
          type: PointConfigType.RESPONSE,
          referenceId: savedMessage._id
        });
      } catch (pointError) {
        console.error("Failed to award points for milestone reply:", pointError);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Reply sent successfully",
        data: {
          conversationId: conversation._id,
          message: savedMessage
        },
        points: pointsResult
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private milestoneViewRepo = AppDataSource.getMongoRepository(MilestoneView);

  /**
   * @swagger
   * /mobile-api/milestones/{id}/view:
   *   post:
   *     summary: Increment milestone view count and record the viewer
   *     tags: [Mobile Milestone]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Post("/:id/view")
  async incrementView(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid Milestone ID");
      const userId = new ObjectId(req.user.userId);
      const milestoneId = new ObjectId(id);

      const milestone = await this.milestoneRepo.findOneBy({ _id: milestoneId });
      if (!milestone) throw new NotFoundError("Milestone not found");

      // Record the view if not already viewed by this user
      const existingView = await this.milestoneViewRepo.findOneBy({ milestoneId, viewerId: userId });
      if (!existingView) {
        const newView = new MilestoneView();
        newView.milestoneId = milestoneId;
        newView.viewerId = userId;
        await this.milestoneViewRepo.save(newView);

        // Increment the count on the milestone entity
        milestone.viewCount = (milestone.viewCount || 0) + 1;
        await this.milestoneRepo.save(milestone);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "View recorded",
        viewCount: milestone.viewCount
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones/{id}/react:
   *   post:
   *     summary: Toggle reaction (clap) on a milestone
   *     tags: [Mobile Milestone]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Post("/:id/react")
  async react(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid Milestone ID");
      const userId = new ObjectId(req.user.userId);
      const milestoneId = new ObjectId(id);

      const milestone = await this.milestoneRepo.findOneBy({ _id: milestoneId });
      if (!milestone) throw new NotFoundError("Milestone not found");

      // Reaction should also count as a view if not already viewed
      let milestoneView = await this.milestoneViewRepo.findOneBy({ milestoneId, viewerId: userId });

      if (!milestoneView) {
        milestoneView = new MilestoneView();
        milestoneView.milestoneId = milestoneId;
        milestoneView.viewerId = userId;
        milestoneView.reacted = true;
        await this.milestoneViewRepo.save(milestoneView);

        milestone.viewCount = (milestone.viewCount || 0) + 1;
        milestone.clapsCount = (milestone.clapsCount || 0) + 1;
      } else {
        // Toggle reaction
        const previousReacted = milestoneView.reacted;
        milestoneView.reacted = !milestoneView.reacted;
        await this.milestoneViewRepo.save(milestoneView);

        // Update clapsCount on milestone
        if (milestoneView.reacted && !previousReacted) {
          milestone.clapsCount = (milestone.clapsCount || 0) + 1;
        } else if (!milestoneView.reacted && previousReacted) {
          milestone.clapsCount = Math.max(0, (milestone.clapsCount || 0) - 1);
        }
      }

      await this.milestoneRepo.save(milestone);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: milestoneView.reacted ? "Reacted successfully" : "Reaction removed",
        reacted: milestoneView.reacted,
        clapsCount: milestone.clapsCount
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones/{id}/viewers:
   *   get:
   *     summary: Get the list of members who viewed this milestone
   *     tags: [Mobile Milestone]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/:id/viewers")
  async getViewers(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid Milestone ID");
      const milestoneId = new ObjectId(id);

      const milestone = await this.milestoneRepo.findOneBy({ _id: milestoneId });
      if (!milestone) throw new NotFoundError("Milestone not found");

      const views = await this.milestoneViewRepo.find({
        where: { milestoneId },
        order: { createdAt: "DESC" }
      });

      const viewerIds = views.map(v => v.viewerId);
      const viewers = viewerIds.length > 0
        ? await this.memberRepo.find({
          where: { _id: { $in: viewerIds } } as any
        })
        : [];

      const viewerMap = new Map(viewers.map(m => [m._id.toString(), m]));

      // Map profiles for response including reacted status
      const viewerProfiles = views.map(v => {
        const m = viewerMap.get(v.viewerId.toString());
        return {
          _id: v.viewerId,
          fullName: m?.fullName,
          profilePhoto: m?.profilePhoto,
          businessName: m?.businessName,
          reacted: v.reacted || false
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        viewCount: milestone.viewCount || 0,
        clapsCount: milestone.clapsCount || 0,
        data: viewerProfiles
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones/{id}:
   *   put:
   *     summary: Update an existing milestone
   *     tags: [Mobile Milestone]
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
   *             $ref: '#/components/schemas/UpdateMilestoneDto'
   */
  @Put("/:id")
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdateMilestoneDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const milestone = await this.milestoneRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!milestone) throw new NotFoundError("Milestone not found");

      if (milestone.memberId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to update this milestone");
      }

      Object.assign(milestone, data);
      const saved = await this.milestoneRepo.save(milestone);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Milestone updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/milestones/{id}:
   *   delete:
   *     summary: Delete a milestone
   *     tags: [Mobile Milestone]
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

      const milestone = await this.milestoneRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!milestone) throw new NotFoundError("Milestone not found");

      if (milestone.memberId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to delete this milestone");
      }

      milestone.isDeleted = true;
      await this.milestoneRepo.save(milestone);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Milestone deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
