import {
  JsonController,
  Get,
  Post,
  Body,
  Param,
  QueryParam,
  Req,
  Res,
  UseBefore,
  NotFoundError,
  BadRequestError,
  Patch,
  Delete,
  Put
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Conversation } from "../../entity/Conversation";
import { Message, MessageType } from "../../entity/Message";
import { Member } from "../../entity/Member";
import { PostModel, PostType } from "../../entity/Post";
import { Category } from "../../entity/Category";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Milestone } from "../../entity/Milestone";
import { OnlineStallProduct } from "../../entity/OnlineStallProduct";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { getIO, isUserInConversation } from "../../utils/socket";
import { pagination } from "../../utils";
import { insertPushNotification } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";
import { PointService } from "../../services/point.service";
import { PointConfigType } from "../../entity/PointConfig";
import { validateRequirementResponseLimit } from "../../services/moduleUsage.service";
import { Contact, ContactType } from "../../entity/Contact";
import { Connection, ConnectionStatus } from "../../entity/Connection";

@JsonController("/chats")
@UseBefore(MobileAuthMiddleware)
export class MobileChatController {
  private conversationRepo = AppDataSource.getMongoRepository(Conversation);
  private messageRepo = AppDataSource.getMongoRepository(Message);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private postRepo = AppDataSource.getMongoRepository(PostModel);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private tySlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private milestoneRepo = AppDataSource.getMongoRepository(Milestone);
  private productRepo = AppDataSource.getMongoRepository(OnlineStallProduct);
  private contactRepo = AppDataSource.getMongoRepository(Contact);
  private connectionRepo = AppDataSource.getMongoRepository(Connection);

  private async isBlocked(userA: ObjectId, userB: ObjectId): Promise<boolean> {
    const blockedConnection = await this.connectionRepo.findOne({
      where: {
        $or: [
          { senderId: userA, receiverId: userB, status: ConnectionStatus.BLOCKED },
          { senderId: userB, receiverId: userA, status: ConnectionStatus.BLOCKED }
        ]
      } as any
    });
    if (blockedConnection) return true;

    // Check if there is a reported conversation between them
    const reportedConversation = await this.conversationRepo.findOne({
      where: {
        participants: { $all: [userA, userB] },
        status: "REPORTED"
      } as any
    });
    if (reportedConversation) return true;

    return false;
  }
  /**
   * @swagger
   * /mobile-api/chats/conversations:
   *   get:
   *     summary: Get list of conversations for the logged-in user
   *     tags: [Mobile Chat]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number (default 0)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Items per page (default 20)
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search by participant name, post/product/milestone title, or last message
   *     security:
   *       - bearerAuth: []
   */
  @Get("/conversations")
  async getConversations(
    @Req() req: any,
    @QueryParam("page") page: number = 0,
    @QueryParam("limit") limit: number = 20,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    try {
      const userId = new ObjectId(req.user.userId);

      const whereClause: any = {
        participants: { $all: [userId] }
      };

      if (search && search.trim()) {
        const queryRegex = { $regex: new RegExp(search.trim(), "i") };

        // Find matching members (exclude self to avoid matching all own conversations)
        const matchedMembers = await this.memberRepo.find({
          where: {
            fullName: queryRegex,
            isDeleted: false
          } as any
        });
        const matchedMemberIds = matchedMembers
          .map(m => m._id)
          .filter(id => !id.equals(userId));

        // Find matching posts
        const matchedPosts = await this.postRepo.find({
          where: {
            title: queryRegex,
            isDeleted: false
          } as any
        });
        const matchedPostIds = matchedPosts.map(p => p._id);

        // Find matching products
        const matchedProducts = await this.productRepo.find({
          where: {
            title: queryRegex,
            isDeleted: false
          } as any
        });
        const matchedProductIds = matchedProducts.map(p => p._id);

        // Find matching milestones
        const matchedMilestones = await this.milestoneRepo.find({
          where: {
            title: queryRegex,
            isDeleted: false
          } as any
        });
        const matchedMilestoneIds = matchedMilestones.map(m => m._id);

        const orClauses: any[] = [{ lastMessage: queryRegex }];

        if (matchedMemberIds.length > 0) {
          orClauses.push({ participants: { $in: matchedMemberIds } });
        }
        if (matchedPostIds.length > 0) {
          orClauses.push({ postId: { $in: matchedPostIds } });
        }
        if (matchedProductIds.length > 0) {
          orClauses.push({ productId: { $in: matchedProductIds } });
        }
        if (matchedMilestoneIds.length > 0) {
          orClauses.push({ milestoneId: { $in: matchedMilestoneIds } });
        }

        whereClause.$or = orClauses;
      }

      const [conversations, total] = await this.conversationRepo.findAndCount({
        where: whereClause as any,
        order: { createdAt: "DESC" },
        take: limit,
        skip: page * limit
      });

      const participantIds = conversations.map(conv =>
        conv.participants.find(p => !p.equals(userId))
      ).filter(id => !!id) as ObjectId[];

      const members = participantIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: participantIds } } as any })
        : [];

      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      const categoryIds = members
        .map(m => m.businessCategory)
        .filter(id => !!id) as ObjectId[];

      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const postIds = conversations
        .map(c => c.postId)
        .filter(id => !!id) as ObjectId[];

      const posts = postIds.length > 0
        ? await this.postRepo.find({ where: { _id: { $in: postIds } } as any })
        : [];

      const postMap = new Map(posts.map(p => [p._id.toString(), p]));

      const milestoneIds = conversations
        .map(c => c.milestoneId)
        .filter(id => !!id) as ObjectId[];

      const milestones = milestoneIds.length > 0
        ? await this.milestoneRepo.find({ where: { _id: { $in: milestoneIds } } as any })
        : [];

      const milestoneMap = new Map(milestones.map(m => [m._id.toString(), m]));

      // Fetch products for product-related conversations
      const productIds = conversations
        .map(c => (c as any).productId)
        .filter(id => !!id) as ObjectId[];

      const products = productIds.length > 0
        ? await this.productRepo.find({ where: { _id: { $in: productIds } } as any })
        : [];

      const productMap = new Map(products.map(p => [p._id.toString(), p]));

      const results = conversations.map(conv => {
        const otherParticipantId = conv.participants.find(p => !p.equals(userId));
        const otherUser = otherParticipantId ? memberMap.get(otherParticipantId.toString()) : null;
        const post = conv.postId ? postMap.get(conv.postId.toString()) : null;
        const product = (conv as any).productId ? productMap.get((conv as any).productId.toString()) : null;

        let categoryName = null;
        if (otherUser && otherUser.businessCategory) {
          categoryName = categoryMap.get(otherUser.businessCategory.toString()) || null;
        }

        const unreadCount = conv.unreadCounts?.[userId.toString()] || 0;

        return {
          ...conv,
          otherUser: otherUser ? {
            _id: otherUser._id,
            fullName: otherUser.fullName,
            profilePhoto: otherUser.profilePhoto,
            categoryName: categoryName,
            isOnline: otherUser.isOnline || false,
            lastSeen: otherUser.lastSeen || null
          } : null,
          post: post || null,
          product: product || null,
          milestone: conv.milestoneId ? milestoneMap.get(conv.milestoneId.toString()) : null,
          status: conv.status || "",
          reportReason: conv.reportReason || null,
          unreadCount
        };
      });

      return pagination(total, results, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/conversations/{id}/read:
   *   patch:
   *     summary: Mark all messages in a conversation as read
   *     tags: [Mobile Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Messages marked as read
   */
  @Patch("/conversations/:id/read")
  async markRead(
    @Req() req: any,
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      const userId = new ObjectId(req.user.userId);
      const conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(id) });
      if (!conversation) throw new NotFoundError("Conversation not found");

      await this.messageRepo.updateMany(
        { conversationId: new ObjectId(id), senderId: { $ne: userId }, isRead: false } as any,
        { $set: { isRead: true } } as any
      );

      // Reset unread count for this user
      const unreadCounts = conversation.unreadCounts || {};
      unreadCounts[userId.toString()] = 0;
      conversation.unreadCounts = { ...unreadCounts };
      await this.conversationRepo.save(conversation);

      // Notify the sender that their messages have been read
      const otherId = conversation.participants.find(p => !p.equals(userId));
      if (otherId) {
        const io = getIO();
        const payload = {
          conversationId: conversation._id,
          readBy: userId,
          readAt: new Date()
        };
        // Emit to the specific conversation room
        io.to(`conversation_${conversation._id}`).emit("messages_read", payload);
        // Also emit directly to the sender's private room
        io.to(otherId.toString()).emit("messages_read", payload);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Messages marked as read"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/messages/{conversationId}:
   *   get:
   *     summary: Get messages for a conversation
   *     tags: [Mobile Chat]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *     security:
   *       - bearerAuth: []
   */
  @Get("/messages/:conversationId")
  async getMessages(
    @Param("conversationId") conversationId: string,
    @QueryParam("page") page: number = 0,
    @QueryParam("limit") limit: number = 20,
    @Req() req: any,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(conversationId)) throw new BadRequestError("Invalid Conversation ID");

      const conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(conversationId) });
      if (!conversation) throw new NotFoundError("Conversation not found");

      const otherParticipantId = conversation.participants.find(p => !p.equals(new ObjectId(req.user.userId)));
      let otherUser = null;
      if (otherParticipantId) {
        const user = await this.memberRepo.findOneBy({ _id: otherParticipantId });
        if (user) {
          let categoryName = null;
          if (user.businessCategory) {
            const cat = await this.categoryRepo.findOneBy({ _id: user.businessCategory });
            categoryName = cat ? cat.name : null;
          }
          otherUser = {
            _id: user._id,
            fullName: user.fullName,
            profilePhoto: user.profilePhoto,
            businessName: user.businessName,
            categoryName: categoryName,
            isOnline: user.isOnline || false,
            lastSeen: user.lastSeen || null
          };
        }
      }

      conversation.postId ? await this.postRepo.findOneBy({ _id: conversation.postId }) : null;

      const [messages, total] = await this.messageRepo.findAndCount({
        where: { conversationId: new ObjectId(conversationId) },
        order: { createdAt: "DESC" },
        take: limit,
        skip: page * limit
      });

      // ✅ Auto-mark unread messages (sent by the other user) as read when the user fetches messages
      const userId = new ObjectId(req.user.userId);
      const hasUnread = messages.some(m => !m.isRead && !m.senderId.equals(userId));
      if (hasUnread) {
        await this.messageRepo.updateMany(
          { conversationId: new ObjectId(conversationId), senderId: { $ne: userId }, isRead: false } as any,
          { $set: { isRead: true } } as any
        );
        // Reset unread count for this user in the conversation
        const unreadCounts = conversation.unreadCounts || {};
        unreadCounts[userId.toString()] = 0;
        conversation.unreadCounts = { ...unreadCounts };
        await this.conversationRepo.save(conversation);

        // Notify the sender that their messages have been read
        const otherParticipant = conversation.participants.find(p => !p.equals(userId));
        if (otherParticipant) {
          const io = getIO();
          const readPayload = { conversationId: conversation._id, readBy: userId, readAt: new Date() };
          io.to(`conversation_${conversation._id}`).emit("messages_read", readPayload);
          io.to(otherParticipant.toString()).emit("messages_read", readPayload);
        }
      }

      const populatedMessages = await Promise.all(messages.map(async (msg) => {
        if (msg.isDeleted) {
          return {
            _id: msg._id,
            conversationId: msg.conversationId,
            senderId: msg.senderId,
            content: "This message was deleted",
            isDeleted: true,
            isRead: msg.isRead || false,
            isMe: msg.senderId.toString() === req.user.userId,
            createdAt: msg.createdAt
          };
        }

        const result: any = {
          ...msg,
          isMe: msg.senderId.toString() === req.user.userId,
          isRead: msg.isRead || false,
          post: null,
          replyTo: null,
          media: msg.media || [],
          businessActionId: msg.businessActionId || null
        };

        if ((msg.type === MessageType.POST_RESPONSE || msg.type === MessageType.POST_SHARE) && msg.postId) {
          result.post = await this.postRepo.findOneBy({ _id: msg.postId });
        }

        if (msg.type === MessageType.PRODUCT_RESPONSE && (msg as any).productId) {
          result.product = await this.productRepo.findOneBy({ _id: (msg as any).productId });
        }

        if (msg.type === MessageType.MILESTONE_REPLY && msg.milestoneId) {
          result.milestone = await this.milestoneRepo.findOneBy({ _id: msg.milestoneId });
        }

        if (msg.replyToMessageId) {
          const repliedMsg = await this.messageRepo.findOneBy({ _id: msg.replyToMessageId });
          if (repliedMsg) {
            result.replyTo = {
              _id: repliedMsg._id,
              content: repliedMsg.content,
              senderId: repliedMsg.senderId,
              type: repliedMsg.type
            };
          }
        }

        if (msg.businessActionId) {
          if (msg.type === MessageType.ONE_TO_ONE) {
            result.businessAction = await this.oneToOneRepo.findOneBy({ _id: msg.businessActionId });
          } else if (msg.type === MessageType.REFERRAL) {
            result.businessAction = await this.referralRepo.findOneBy({ _id: msg.businessActionId });
          } else if (msg.type === MessageType.THANK_YOU_SLIP) {
            result.businessAction = await this.tySlipRepo.findOneBy({ _id: msg.businessActionId });
          }
        }

        return result;
      }));

      return res.status(200).json({
        success: true,
        message: "Messages retrieved successfully",
        otherUser,
        data: populatedMessages.reverse(),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/conversations/{id}/status:
   *   put:
   *     summary: Update the status of a conversation (Useful, Rejected, etc.)
   *     tags: [Mobile Chat]
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
   *               status:
   *                 type: string
   *                 enum: [USEFUL, MAY_BE_LATER, REJECTED, REPORTED]
   *                 example: "USEFUL"
   *               reason:
   *                 type: string
   *                 description: Required if status is REPORTED
   *                 example: "Inappropriate behavior"
   *     responses:
   *       200:
   *         description: Status updated successfully
   */
  @Put("/conversations/:id/status")
  async updateConversationStatus(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { status: string; reason?: string },
    @Res() res: any
  ) {
    try {
      const userId = new ObjectId(req.user.userId);
      const { status, reason } = body;

      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid Conversation ID");

      const conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(id) });
      if (!conversation) throw new NotFoundError("Conversation not found");

      // Verify participant
      if (!conversation.participants.some(p => p.equals(userId))) {
        throw new BadRequestError("You are not a participant in this conversation");
      }

      conversation.status = status as any;
      if (status === "REPORTED") {
        conversation.reportedBy = userId;
        conversation.reportReason = reason;
      }

      await this.conversationRepo.save(conversation);

      // Notify the other participant
      const otherId = conversation.participants.find(p => !p.equals(userId));
      if (otherId) {
        getIO().to(otherId.toString()).emit("conversation_status_updated", {
          conversationId: conversation._id,
          status: status
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Conversation status updated to ${status}`,
        data: conversation
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/respond-to-post:
   *   post:
   *     summary: Initiate a chat response to a post
   *     tags: [Mobile Chat]
   */
  @Post("/respond-to-post")
  async respondToPost(@Req() req: any, @Body() data: { postId: string; message: string }, @Res() res: any) {
    try {
      const senderId = new ObjectId(req.user.userId);
      const { postId, message } = data;

      if (!ObjectId.isValid(postId)) throw new BadRequestError("Invalid Post ID");

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(postId) });
      if (!post) throw new NotFoundError("Post not found");

      if (post.type === PostType.REQUIREMENT) {
        await validateRequirementResponseLimit(senderId);
      }

      // Increment response count
      post.responsedCount = (post.responsedCount || 0) + 1;
      await this.postRepo.save(post);

      const receiverId = post.memberId;
      if (senderId.equals(receiverId)) throw new BadRequestError("You cannot respond to your own post");

      if (await this.isBlocked(senderId, receiverId)) {
        throw new BadRequestError("You cannot send messages to this member.");
      }

      let conversation = await this.conversationRepo.findOne({
        where: {
          participants: { $all: [senderId, receiverId] },
          postId: new ObjectId(postId)
        } as any
      });

      if (!conversation) {
        conversation = new Conversation();
        conversation.participants = [senderId, receiverId];
        conversation.postId = new ObjectId(postId);
        conversation.status = "PENDING";
        conversation = await this.conversationRepo.save(conversation);
      } else {
        // Check if sender already responded or shared this post in this conversation
        const existingResponse = await this.messageRepo.findOne({
          where: {
            conversationId: conversation._id,
            senderId: senderId,
            postId: new ObjectId(postId),
            type: { $in: [MessageType.POST_RESPONSE, MessageType.POST_SHARE] }
          } as any
        });

        if (existingResponse) {
          return res.status(StatusCodes.OK).json({
            success: true,
            message: "You have already responded to this post",
            data: {
              conversationId: conversation._id,
              message: existingResponse
            }
          });
        }
      }

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = message || "Hi, I'm interested in your post.";
      newMessage.type = MessageType.POST_RESPONSE;
      newMessage.postId = new ObjectId(postId);
      newMessage.isDeleted = false;
      // Check if receiver is in the chat room
      const isReceiverActive = isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      // Send Push Notification if receiver is not active in the chat room and has fcmToken
      const receiver = await this.memberRepo.findOneBy({ _id: receiverId, isDeleted: false });
      if (!isReceiverActive && receiver?.fcmToken) {
        // const sender = await this.memberRepo.findOneBy({ _id: senderId });
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: `New Message for ${post.title}`,
          content: newMessage.content,
          moduleName: NotificationModule.MESSAGE_REQUEST,
          moduleId: conversation._id.toString(),
          receiverId: receiverId.toString(),
          senderId: senderId.toString()
        });
      }

      conversation.lastMessage = newMessage.content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      // Update unread count for receiver
      const unreadCounts = conversation.unreadCounts || {};
      if (isReceiverActive) {
        unreadCounts[receiverId.toString()] = 0;
      } else {
        unreadCounts[receiverId.toString()] = (unreadCounts[receiverId.toString()] || 0) + 1;
      }
      conversation.unreadCounts = { ...unreadCounts };

      await this.conversationRepo.save(conversation);

      const io = getIO();
      io.to(receiverId.toString()).emit("new_message", {
        ...savedMessage,
        post
      });

      // Emit conversation update for the conversation list screen
      const sender = await this.memberRepo.findOneBy({ _id: senderId });
      let senderCategoryName = null;
      if (sender && sender.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
        senderCategoryName = cat ? cat.name : null;
      }

      const unreadCount = conversation.unreadCounts?.[receiverId.toString()] || 0;

      io.to(receiverId.toString()).emit("conversation_updated", {
        ...conversation,
        lastMessage: savedMessage.content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: savedMessage.senderId,
        otherUser: sender ? {
          _id: sender._id,
          fullName: sender.fullName,
          profilePhoto: sender.profilePhoto,
          categoryName: senderCategoryName,
          isOnline: sender.isOnline || false,
          lastSeen: sender.lastSeen || null
        } : null,
        post: post || null,
        unreadCount
      });

      let pointsResult = { awarded: 0, balance: 0 };
      try {
        let moduleName = post.type.charAt(0).toUpperCase() + post.type.slice(1).toLowerCase();
        let pointModuleName = moduleName;
        if (post.type === PostType.PROMOTION) {
          pointModuleName = "Post";
        }
        const pointService = new PointService();
        pointsResult = await pointService.awardPoints({
          memberId: senderId,
          moduleName: pointModuleName,
          type: PointConfigType.RESPONSE,
          referenceId: savedMessage._id
        });
      } catch (pointError) {
        console.error("Failed to award points for post response:", pointError);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Message sent successfully",
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

  /**
   * @swagger
   * /mobile-api/chats/respond-to-product:
   *   post:
   *     summary: Initiate a chat response to an online stall product
   *     tags: [Mobile Chat]
   */
  @Post("/respond-to-product")
  async respondToProduct(@Req() req: any, @Body() data: { productId: string; message: string }, @Res() res: any) {
    try {
      const senderId = new ObjectId(req.user.userId);
      const { productId, message } = data;

      if (!productId || !ObjectId.isValid(productId)) throw new BadRequestError("Invalid Product ID");

      const product = await this.productRepo.findOneBy({ _id: new ObjectId(productId), isDeleted: false });
      if (!product) throw new NotFoundError("Product not found");

      const receiverId = product.memberId;
      if (senderId.equals(receiverId)) throw new BadRequestError("You cannot respond to your own product");

      if (await this.isBlocked(senderId, receiverId)) {
        throw new BadRequestError("You cannot send messages to this member.");
      }

      let conversation = await this.conversationRepo.findOne({
        where: {
          participants: { $all: [senderId, receiverId] },
          productId: new ObjectId(productId)
        } as any
      });

      if (!conversation) {
        conversation = new Conversation();
        conversation.participants = [senderId, receiverId];
        (conversation as any).productId = new ObjectId(productId);
        conversation.status = "PENDING";
        conversation = await this.conversationRepo.save(conversation);
      } else {
        // Check if sender already responded to this product in this conversation
        const existingResponse = await this.messageRepo.findOne({
          where: {
            conversationId: conversation._id,
            senderId: senderId,
            type: MessageType.PRODUCT_RESPONSE,
            productId: new ObjectId(productId)
          } as any
        });

        if (existingResponse) {
          return res.status(StatusCodes.OK).json({
            success: true,
            message: "You have already responded to this product",
            data: {
              conversationId: conversation._id,
              message: existingResponse
            }
          });
        }
      }

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = message || "Hi, I'm interested in your product.";
      newMessage.type = MessageType.PRODUCT_RESPONSE;
      (newMessage as any).productId = new ObjectId(productId);

      // Check if receiver is in the chat room
      const isReceiverActive = isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      // Send Push Notification if receiver is not active in the chat room and has fcmToken
      const receiver = await this.memberRepo.findOneBy({ _id: receiverId, isDeleted: false });
      if (!isReceiverActive && receiver?.fcmToken) {
        // const sender = await this.memberRepo.findOneBy({ _id: senderId });
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: "New Message for product - " + product.productName,
          content: newMessage.content,
          moduleName: NotificationModule.MESSAGE_REQUEST,
          moduleId: conversation._id.toString(),
          receiverId: receiverId.toString(),
          senderId: senderId.toString()
        });
      }

      conversation.lastMessage = newMessage.content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      // Update unread count for receiver
      const unreadCounts = conversation.unreadCounts || {};
      if (isReceiverActive) {
        unreadCounts[receiverId.toString()] = 0;
      } else {
        unreadCounts[receiverId.toString()] = (unreadCounts[receiverId.toString()] || 0) + 1;
      }
      conversation.unreadCounts = { ...unreadCounts };

      await this.conversationRepo.save(conversation);

      const io = getIO();
      io.to(receiverId.toString()).emit("new_message", {
        ...savedMessage,
        product
      });

      // Emit conversation update for the conversation list screen
      const sender = await this.memberRepo.findOneBy({ _id: senderId });
      let senderCategoryName = null;
      if (sender && sender.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
        senderCategoryName = cat ? cat.name : null;
      }

      const unreadCount = conversation.unreadCounts?.[receiverId.toString()] || 0;

      io.to(receiverId.toString()).emit("conversation_updated", {
        ...conversation,
        lastMessage: savedMessage.content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: savedMessage.senderId,
        otherUser: sender ? {
          _id: sender._id,
          fullName: sender.fullName,
          profilePhoto: sender.profilePhoto,
          categoryName: senderCategoryName,
          isOnline: sender.isOnline || false,
          lastSeen: sender.lastSeen || null
        } : null,
        product: product || null,
        unreadCount
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Message sent successfully",
        data: {
          conversationId: conversation._id,
          message: savedMessage
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/send-message:
   *   post:
   *     summary: Send a direct message
   *     tags: [Mobile Chat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               conversationId:
   *                 type: string
   *               content:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [TEXT, IMAGE, ONE_TO_ONE, REFERRAL, THANK_YOU_SLIP]
   *               replyToMessageId:
   *                 type: string
   *               media:
   *                 type: array
   *                 items:
   *                   type: string
   *               businessActionId:
   *                 type: string
   *               actionData:
   *                 type: object
   *                 description: Data for OneToOne, Referral, or ThankYouSlip
   */
  @Post("/send-message")
  async sendMessage(
    @Req() req: any,
    @Body() data: {
      conversationId: string;
      content?: string;
      type?: MessageType;
      replyToMessageId?: string;
      media?: string[];
      businessActionId?: string;
      actionData?: any;
    },
    @Res() res: any
  ) {
    try {
      const senderId = new ObjectId(req.user.userId);
      let pointsResult = { awarded: 0, balance: 0 };
      let { conversationId, content, type = MessageType.TEXT, replyToMessageId, media, businessActionId, actionData } = data;

      if (!ObjectId.isValid(conversationId)) throw new BadRequestError("Invalid Conversation ID");

      const conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(conversationId) });
      if (!conversation) throw new NotFoundError("Conversation not found");

      const receiverId = conversation.participants.find(p => !p.equals(senderId));
      if (!receiverId) throw new BadRequestError("No receiver found in this conversation");

      if (conversation.status === "REPORTED") {
        throw new BadRequestError("You cannot send messages in a reported conversation.");
      }
      if (await this.isBlocked(senderId, receiverId)) {
        throw new BadRequestError("You cannot send messages to this member.");
      }

      // Auto-generate content for Business Actions if missing
      if (!content) {
        if (type === MessageType.ONE_TO_ONE) content = "One to One Completed";
        else if (type === MessageType.REFERRAL) content = "Shared a Referral";
        else if (type === MessageType.THANK_YOU_SLIP) content = "Sent a Thank You Slip";
        else if (type === MessageType.IMAGE) content = "Sent an Image";
        else content = "";
      }
      if (type === MessageType.REFERRAL) {
        const contact = new Contact();
        contact.name = actionData.name;
        contact.phoneNumber = actionData.phone;
        contact.type = ContactType.REFERRED;
        contact.createdBy = senderId;
        contact.modifiedBy = senderId;
        contact.isActive = true;
        contact.isDeleted = false;
        contact.referredBy = receiverId;
        await this.contactRepo.save(contact);
      }

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = content;
      newMessage.type = type;

      // Check if receiver is in the chat room
      const isReceiverActive = isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      // Handle Automatic Business Action Creation
      if ([MessageType.ONE_TO_ONE, MessageType.REFERRAL, MessageType.THANK_YOU_SLIP].includes(type)) {
        let moduleName = "";
        if (type === MessageType.ONE_TO_ONE) moduleName = "One to One";
        else if (type === MessageType.REFERRAL) moduleName = "Referral";
        else if (type === MessageType.THANK_YOU_SLIP) moduleName = "Thank you Slip";

        // await validateModuleUsage(senderId, moduleName);
        if (type === MessageType.ONE_TO_ONE) {
          const oto = new OneToOne();
          oto.senderId = senderId;
          oto.receiverId = receiverId;
          oto.media = media; // Store the screenshot in the business record too
          const savedOto = await this.oneToOneRepo.save(oto);
          newMessage.businessActionId = savedOto._id;

          // Award Points (Response type for One to One)
          try {
            const pointService = new PointService();
            pointsResult = await pointService.awardPoints({
              memberId: senderId,
              moduleName: "One to One",
              type: PointConfigType.RESPONSE,
              referenceId: savedOto._id
            });
          } catch (pointError) {
            console.error("Failed to award points for One to One:", pointError);
          }
        } else if (type === MessageType.REFERRAL) {
          const ref = new Referral();
          ref.senderId = senderId;
          ref.receiverId = receiverId;
          ref.referralName = actionData.referralName || actionData.name;
          ref.referralMobile = actionData.referralMobile || actionData.phone;
          ref.referralEmail = actionData.referralEmail || actionData.email;
          ref.location = actionData.location;
          ref.comments = actionData.comments;
          const savedRef = await this.referralRepo.save(ref);
          newMessage.businessActionId = savedRef._id;

          // Award Points (Creation type for Referral)
          try {
            const pointService = new PointService();
            pointsResult = await pointService.awardPoints({
              memberId: senderId,
              moduleName: "Referral",
              type: PointConfigType.CREATION,
              referenceId: savedRef._id
            });
          } catch (pointError) {
            console.error("Failed to award points for Referral:", pointError);
          }
        } else if (type === MessageType.THANK_YOU_SLIP) {
          const ty = new ThankYouSlip();
          ty.senderId = senderId;
          ty.receiverId = receiverId;
          ty.amount = Number(actionData.amount) || Number(actionData.businessAmount) || 0;
          ty.businessDetails = actionData.businessDetails || actionData.remarks || content;
          const savedTy = await this.tySlipRepo.save(ty);
          newMessage.businessActionId = savedTy._id;

          // Award Points (Creation type for Thank you Slip)
          try {
            const pointService = new PointService();
            pointsResult = await pointService.awardPoints({
              memberId: senderId,
              moduleName: "Thank you Slip",
              type: PointConfigType.CREATION,
              referenceId: savedTy._id
            });
          } catch (pointError) {
            console.error("Failed to award points for Thank you Slip:", pointError);
          }
        }
      } else if (businessActionId && ObjectId.isValid(businessActionId)) {
        newMessage.businessActionId = new ObjectId(businessActionId);
      }

      if (replyToMessageId && ObjectId.isValid(replyToMessageId)) {
        newMessage.replyToMessageId = new ObjectId(replyToMessageId);
      }

      if (media) {
        newMessage.media = media;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      // Send Push Notification if receiver is not active in the chat room and has fcmToken
      const receiver = await this.memberRepo.findOneBy({ _id: receiverId, isDeleted: false });
      if (!isReceiverActive && receiver?.fcmToken) {
        // const sender = await this.memberRepo.findOneBy({ _id: senderId });
        let notificationModule = NotificationModule.MESSAGE;
        if (type === MessageType.ONE_TO_ONE) {
          notificationModule = NotificationModule.ONE_TO_ONE;
        } else if (type === MessageType.REFERRAL) {
          notificationModule = NotificationModule.REFERRAL;
        } else if (type === MessageType.THANK_YOU_SLIP) {
          notificationModule = NotificationModule.THANK_YOU_SLIP;
        }

        await insertPushNotification({
          token: receiver.fcmToken,
          subject: "New Message",
          content: newMessage.content,
          moduleName: notificationModule,
          moduleId: conversation._id.toString(),
          receiverId: receiverId.toString(),
          senderId: senderId.toString()
        });
      }

      conversation.lastMessage = content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      // Update unread count for receiver
      const unreadCounts = conversation.unreadCounts || {};
      if (isReceiverActive) {
        unreadCounts[receiverId.toString()] = 0;
      } else {
        unreadCounts[receiverId.toString()] = (unreadCounts[receiverId.toString()] || 0) + 1;
      }
      conversation.unreadCounts = { ...unreadCounts };

      await this.conversationRepo.save(conversation);

      if (receiverId) {
        const io = getIO();

        // Prepare fully populated message for the socket
        const populatedMessage: any = {
          ...savedMessage,
          isMe: false,
          businessAction: null
        };

        if (savedMessage.businessActionId) {
          if (savedMessage.type === MessageType.ONE_TO_ONE) {
            populatedMessage.businessAction = await this.oneToOneRepo.findOneBy({ _id: savedMessage.businessActionId });
          } else if (savedMessage.type === MessageType.REFERRAL) {
            populatedMessage.businessAction = await this.referralRepo.findOneBy({ _id: savedMessage.businessActionId });
          } else if (savedMessage.type === MessageType.THANK_YOU_SLIP) {
            populatedMessage.businessAction = await this.tySlipRepo.findOneBy({ _id: savedMessage.businessActionId });
          }
        }

        io.to(receiverId.toString()).emit("new_message", populatedMessage);

        // Emit conversation update for the conversation list screen
        const sender = await this.memberRepo.findOneBy({ _id: senderId });
        let senderCategoryName = null;
        if (sender && sender.businessCategory) {
          const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
          senderCategoryName = cat ? cat.name : null;
        }

        const unreadCount = conversation.unreadCounts?.[receiverId.toString()] || 0;

        io.to(receiverId.toString()).emit("conversation_updated", {
          ...conversation,
          lastMessage: savedMessage.content,
          lastMessageTime: savedMessage.createdAt,
          lastMessageSenderId: savedMessage.senderId,
          otherUser: sender ? {
            _id: sender._id,
            fullName: sender.fullName,
            profilePhoto: sender.profilePhoto,
            categoryName: senderCategoryName,
            isOnline: sender.isOnline || false,
            lastSeen: sender.lastSeen || null
          } : null,
          unreadCount
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: savedMessage,
        points: pointsResult
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/messages/{messageId}:
   *   patch:
   *     summary: Edit a message
   *     tags: [Mobile Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
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
   */
  @Patch("/messages/:messageId")
  async editMessage(@Req() req: any, @Param("messageId") messageId: string, @Body() data: { content: string }, @Res() res: any) {
    try {
      const userId = new ObjectId(req.user.userId);
      const message = await this.messageRepo.findOneBy({ _id: new ObjectId(messageId) });

      if (!message) throw new NotFoundError("Message not found");
      if (!message.senderId.equals(userId)) throw new BadRequestError("You can only edit your own messages");
      if (message.isDeleted) throw new BadRequestError("Cannot edit a deleted message");

      message.content = data.content;
      message.isEdited = true;
      await this.messageRepo.save(message);

      const conversation = await this.conversationRepo.findOneBy({ _id: message.conversationId });
      if (conversation) {
        const otherId = conversation.participants.find(p => !p.equals(userId));
        if (otherId) {
          getIO().to(otherId.toString()).emit("message_edited", {
            messageId: message._id,
            newContent: message.content
          });
        }
      }

      return res.status(StatusCodes.OK).json({ success: true, data: message });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/messages/{messageId}:
   *   delete:
   *     summary: Delete a message
   *     tags: [Mobile Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: string
   */
  @Delete("/messages/:messageId")
  async deleteMessage(@Req() req: any, @Param("messageId") messageId: string, @Res() res: any) {
    try {
      const userId = new ObjectId(req.user.userId);
      const message = await this.messageRepo.findOneBy({ _id: new ObjectId(messageId) });

      if (!message) throw new NotFoundError("Message not found");
      if (!message.senderId.equals(userId)) throw new BadRequestError("You can only delete your own messages");

      message.isDeleted = true;
      message.content = "This message was deleted";
      await this.messageRepo.save(message);

      const conversation = await this.conversationRepo.findOneBy({ _id: message.conversationId });
      if (conversation) {
        const otherId = conversation.participants.find(p => !p.equals(userId));
        if (otherId) {
          getIO().to(otherId.toString()).emit("message_deleted", {
            messageId: message._id
          });
        }
      }

      return res.status(StatusCodes.OK).json({ success: true, message: "Message deleted" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chats/birthday-wish:
   *   post:
   *     summary: Send a birthday wish and create/find direct conversation
   *     tags: [Mobile Chat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               receiverId:
   *                 type: string
   *                 example: "60c72b2f9b1d8e1f5c8b4567"
   *               message:
   *                 type: string
   *                 example: "Happy Birthday! Wishing you a great year ahead. 🎉"
   */
  @Post("/birthday-wish")
  async birthdayWish(
    @Req() req: any,
    @Body() data: { receiverId: string; },
    @Res() res: any
  ) {
    try {
      const senderId = new ObjectId(req.user.userId);
      const { receiverId } = data;

      if (!receiverId || !ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid receiver ID");
      }

      const recId = new ObjectId(receiverId);
      if (senderId.equals(recId)) {
        throw new BadRequestError("You cannot send a birthday wish to yourself");
      }

      const receiver = await this.memberRepo.findOneBy({ _id: recId, isDeleted: false });
      if (!receiver) {
        throw new NotFoundError("Receiver not found");
      }

      if (await this.isBlocked(senderId, recId)) {
        throw new BadRequestError("You cannot send messages to this member.");
      }

      // // Find or create direct conversation between sender and receiver (no post/product/milestone context)
      // let conversation = await this.conversationRepo.findOne({
      //   where: {
      //     participants: { $all: [senderId, recId] },
      //     postId: { $exists: false },
      //     productId: { $exists: false },
      //     milestoneId: { $exists: false }
      //   } as any
      // });

      // if (!conversation) {
      let conversation = new Conversation();
      conversation.participants = [senderId, recId];
      conversation.status = "ACCEPTED";
      conversation = await this.conversationRepo.save(conversation);
      // }

      const content = "Happy Birthday! 🎂🎉";

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = content;
      newMessage.type = MessageType.TEXT;
      newMessage.isDeleted = false;

      // Check if receiver is in the chat room
      const isReceiverActive = isUserInConversation(recId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      // Send Push Notification if receiver is not active in the chat room and has fcmToken
      if (!isReceiverActive && receiver.fcmToken) {
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: "Birthday Wish! 🎂",
          content: content,
          moduleName: NotificationModule.BIRTHDAY,
          moduleId: conversation._id.toString(),
          receiverId: recId.toString(),
          senderId: senderId.toString()
        });
      }

      // Update conversation details
      conversation.lastMessage = content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      const unreadCounts = conversation.unreadCounts || {};
      if (isReceiverActive) {
        unreadCounts[recId.toString()] = 0;
      } else {
        unreadCounts[recId.toString()] = (unreadCounts[recId.toString()] || 0) + 1;
      }
      conversation.unreadCounts = { ...unreadCounts };

      await this.conversationRepo.save(conversation);

      // Emit sockets
      const io = getIO();
      const populatedMessage = {
        ...savedMessage,
        isMe: false,
        businessAction: null
      };

      io.to(recId.toString()).emit("new_message", populatedMessage);

      const sender = await this.memberRepo.findOneBy({ _id: senderId });
      let senderCategoryName = null;
      if (sender && sender.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
        senderCategoryName = cat ? cat.name : null;
      }

      const unreadCount = conversation.unreadCounts?.[recId.toString()] || 0;

      io.to(recId.toString()).emit("conversation_updated", {
        ...conversation,
        lastMessage: content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: senderId,
        otherUser: sender ? {
          _id: sender._id,
          fullName: sender.fullName,
          profilePhoto: sender.profilePhoto,
          categoryName: senderCategoryName,
          isOnline: sender.isOnline || false,
          lastSeen: sender.lastSeen || null
        } : null,
        unreadCount
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Birthday wish sent successfully",
        data: {
          conversationId: conversation._id,
          message: savedMessage
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
