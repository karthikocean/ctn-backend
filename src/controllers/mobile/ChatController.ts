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
import { Referral, ReferralStatus } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Milestone } from "../../entity/Milestone";
import { OnlineStallProduct } from "../../entity/OnlineStallProduct";
import { ReportedHistory } from "../../entity/ReportedHistory";
import { Reminder, ReminderRecipientType } from "../../entity/Reminder";
import { ReminderService } from "../../services/ReminderService";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { getIO, isUserInConversation } from "../../utils/socket";
import { pagination } from "../../utils";
import { insertPushNotification } from "../../services/pushnotification.service";
import { NotificationModule, PushNotification } from "../../entity/PushNotifications";
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
  private pushNotificationRepo = AppDataSource.getMongoRepository(PushNotification);
  private reminderRepo = AppDataSource.getMongoRepository(Reminder);

  private async isMutual(userA: ObjectId, userB: ObjectId): Promise<boolean> {
    if (userA.equals(userB)) return true;
    const [conn1, conn2] = await Promise.all([
      this.connectionRepo.findOne({
        where: { senderId: userA, receiverId: userB, status: ConnectionStatus.ACCEPTED, isDeleted: false } as any
      }),
      this.connectionRepo.findOne({
        where: { senderId: userB, receiverId: userA, status: ConnectionStatus.ACCEPTED, isDeleted: false } as any
      })
    ]);
    return !!(conn1 && conn2);
  }

  private async isBlocked(userA: ObjectId, userB: ObjectId): Promise<boolean> {
    const blockedConnection = await this.connectionRepo.findOne({
      where: {
        $or: [
          { senderId: userA, receiverId: userB, status: ConnectionStatus.BLOCKED },
          { senderId: userB, receiverId: userA, status: ConnectionStatus.BLOCKED }
        ],
        isDeleted: false
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

    const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
    const reportedHistory = await reportedHistoryRepo.findOne({
      where: {
        $or: [
          { reporterUserId: userA, targetUserId: userB },
          { reporterUserId: userB, targetUserId: userA }
        ]
      } as any
    });
    if (reportedHistory) return true;

    return false;
  }

  private async getOrCreateConversation(senderId: ObjectId, receiverId: ObjectId): Promise<Conversation> {
    const isMutual = await this.isMutual(senderId, receiverId);
    let conversation = await this.conversationRepo.findOne({
      where: {
        participants: { $all: [senderId, receiverId] }
      } as any,
      order: { updatedAt: "DESC" }
    });

    if (!conversation) {
      conversation = new Conversation();
      conversation.participants = [senderId, receiverId];
      conversation.status = isMutual ? "ACCEPTED" : "PENDING";
      conversation.unreadCounts = {};
      conversation = await this.conversationRepo.save(conversation);
    } else {
      const wasRejectedOrDeleted =
        conversation.status === "REJECTED" ||
        conversation.status === "DELETED" ||
        conversation.isDeleted ||
        !!conversation.deletedBy;

      let needSave = false;
      if (wasRejectedOrDeleted) {
        conversation.status = "PENDING";
        conversation.isDeleted = false;
        delete conversation.deletedBy;
        conversation.userStatuses = {};
        delete (conversation as any).statusUpdatedBy;
        needSave = true;
      } else if (isMutual && conversation.status === "PENDING") {
        conversation.status = "ACCEPTED";
        needSave = true;
      }

      if (needSave) {
        await this.conversationRepo.save(conversation);
      }
    }

    return conversation;
  }
  private getEffectiveStatus(conv: any, userIdStr: string, isMutual: boolean = false): string {
    const myUserStatus = conv.userStatuses?.[userIdStr];
    if (conv.status === "DELETED" || myUserStatus === "DELETED") {
      return "DELETED";
    }
    if (myUserStatus) {
      return myUserStatus;
    }
    if (conv.status === "REPORTED") {
      return "REPORTED";
    }
    if (isMutual && conv.status === "PENDING") {
      return "ACCEPTED";
    }
    if (conv.status === "USEFUL" || conv.status === "MAY_BE_LATER" || conv.status === "MAYBE_LATER" || conv.status === "REJECTED") {
      if (conv.statusUpdatedBy && conv.statusUpdatedBy.toString() === userIdStr) {
        return conv.status;
      }
      return "ACCEPTED";
    }
    return conv.status || "ACCEPTED";
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
   *         name: type
   *         schema:
   *           type: string
   *         description: Filter conversations by type (ALL, REQUEST, PENDING, USEFUL, MAY_BE_LATER, REJECTED)
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *         description: Filter conversations by status
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
    @QueryParam("type") type: string,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    try {
      const userId = new ObjectId(req.user.userId);
      const userIdStr = userId.toString();

      const whereClause: any = {
        participants: { $all: [userId] },
        deletedBy: { $nin: [userId] }
      };

      const filterKey = (type || status || "").trim().toUpperCase();
      if (filterKey && filterKey !== "ALL") {
        if (filterKey === "REQUEST" || filterKey === "REQUESTS" || filterKey === "REQUESTED") {
          whereClause.status = "PENDING";
          whereClause.lastMessageSenderId = { $ne: userId };
        } else if (filterKey === "PENDING") {
          whereClause.status = "PENDING";
          whereClause.lastMessageSenderId = userId;
        } else if (filterKey === "USEFUL") {
          whereClause.$or = [
            { status: "USEFUL", statusUpdatedBy: userId },
            { [`userStatuses.${userIdStr}`]: "USEFUL" }
          ];
        } else if (filterKey === "MAY_BE_LATER" || filterKey === "MAYBE_LATER" || filterKey === "MAY BE LATER") {
          whereClause.$or = [
            { status: { $in: ["MAY_BE_LATER", "MAYBE_LATER"] }, statusUpdatedBy: userId },
            { [`userStatuses.${userIdStr}`]: { $in: ["MAY_BE_LATER", "MAYBE_LATER"] } }
          ];
        } else if (filterKey === "REJECTED") {
          whereClause.$or = [
            { status: "REJECTED", statusUpdatedBy: userId },
            { [`userStatuses.${userIdStr}`]: "REJECTED" }
          ];
        } else if (filterKey === "ACCEPTED") {
          whereClause.$or = [
            { status: "ACCEPTED" },
            {
              status: { $in: ["USEFUL", "MAY_BE_LATER", "MAYBE_LATER", "REJECTED"] },
              statusUpdatedBy: { $ne: userId }
            },
            {
              [`userStatuses.${userIdStr}`]: "ACCEPTED"
            }
          ];
        }
      }

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

        if (whereClause.$or) {
          const filterOr = whereClause.$or;
          delete whereClause.$or;
          whereClause.$and = [
            { $or: filterOr },
            { $or: orClauses }
          ];
        } else {
          whereClause.$or = orClauses;
        }
      }

      const conversationsRaw = await this.conversationRepo.find({
        where: whereClause as any,
        order: { lastMessageTime: "DESC", createdAt: "DESC", updatedAt: "DESC" }
      });
      console.log(conversationsRaw.length, "conversationsRaw");
      const groupedConversations = new Map<string, Conversation>();
      for (const conv of conversationsRaw) {
        const otherParticipantId = conv.participants.find(p => !p.equals(userId));
        if (!otherParticipantId) continue;
        const key = otherParticipantId.toString();

        const getConvTime = (c: Conversation) => {
          if (c.lastMessageTime) return new Date(c.lastMessageTime).getTime();
          if (c.createdAt) return new Date(c.createdAt).getTime();
          return 0;
        };

        if (!groupedConversations.has(key)) {
          groupedConversations.set(key, conv);
        } else {
          const existing = groupedConversations.get(key)!;
          const existingTime = getConvTime(existing);
          const currTime = getConvTime(conv);
          if (currTime > existingTime) {
            const unread = (existing.unreadCounts?.[userId.toString()] || 0) + (conv.unreadCounts?.[userId.toString()] || 0);
            conv.unreadCounts = { ...(conv.unreadCounts || {}), [userId.toString()]: unread };
            groupedConversations.set(key, conv);
          }
        }
      }

      const allUniqueConversations = Array.from(groupedConversations.values());
      allUniqueConversations.sort((a, b) => {
        const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeB - timeA;
      });
      const total = allUniqueConversations.length;
      const conversations = allUniqueConversations.slice(page * limit, (page + 1) * limit);

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

      // Batch check mutual connections and blocked/reported members for all participants
      const mutualConnections = participantIds.length > 0 ? await this.connectionRepo.find({
        where: {
          $or: [
            { senderId: userId, receiverId: { $in: participantIds }, status: ConnectionStatus.ACCEPTED, isDeleted: false },
            { receiverId: userId, senderId: { $in: participantIds }, status: ConnectionStatus.ACCEPTED, isDeleted: false }
          ]
        } as any
      }) : [];
      const followingSet = new Set(mutualConnections.filter(c => c.senderId.equals(userId)).map(c => c.receiverId.toString()));
      const followerSet = new Set(mutualConnections.filter(c => c.receiverId.equals(userId)).map(c => c.senderId.toString()));
      const mutualSet = new Set([...followingSet].filter(id => followerSet.has(id)));

      const blockedConnections = participantIds.length > 0 ? await this.connectionRepo.find({
        where: {
          $or: [
            { senderId: userId, receiverId: { $in: participantIds }, status: ConnectionStatus.BLOCKED, isDeleted: false },
            { receiverId: userId, senderId: { $in: participantIds }, status: ConnectionStatus.BLOCKED, isDeleted: false }
          ]
        } as any
      }) : [];
      const blockedSet = new Set(
        blockedConnections.map(c => c.senderId.equals(userId) ? c.receiverId.toString() : c.senderId.toString())
      );

      const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
      const reportedHistories = participantIds.length > 0 ? await reportedHistoryRepo.find({
        where: {
          $or: [
            { reporterUserId: userId, targetUserId: { $in: participantIds } },
            { reporterUserId: { $in: participantIds }, targetUserId: userId }
          ]
        } as any
      }) : [];
      for (const r of reportedHistories) {
        if (r.reporterUserId?.equals(userId)) {
          blockedSet.add(r.targetUserId.toString());
        } else if (r.targetUserId?.equals(userId)) {
          blockedSet.add(r.reporterUserId.toString());
        }
      }

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

      // Ensure lastMessage visible to current user (hide opposite member's private self-reminders)
      const convIds = conversations.map(c => c._id);
      const latestMsgs = convIds.length > 0 ? await this.messageRepo.find({
        where: { conversationId: { $in: convIds }, isDeleted: { $ne: true } } as any,
        order: { createdAt: "DESC" }
      }) : [];

      const latestMsgMap = new Map<string, Message[]>();
      for (const m of latestMsgs) {
        const cId = m.conversationId.toString();
        if (!latestMsgMap.has(cId)) latestMsgMap.set(cId, []);
        latestMsgMap.get(cId)!.push(m);
      }
      // Ensure each conversation's messages are sorted newest-first
      for (const [cId, msgs] of latestMsgMap) {
        msgs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      const reminderIdsToCheck = latestMsgs
        .filter(m => (m.type as any) === MessageType.REMINDER || m.reminderId || m.businessActionId)
        .map(m => m.reminderId || m.businessActionId!)
        .filter(id => !!id);

      const remindersList = reminderIdsToCheck.length > 0
        ? await this.reminderRepo.find({ where: { _id: { $in: reminderIdsToCheck } } as any })
        : [];
      const reminderMap = new Map(remindersList.map(r => [r._id.toString(), r]));

      const results = conversations.map(conv => {
        const otherParticipantId = conv.participants.find(p => !p.equals(userId));
        const otherUser = otherParticipantId ? memberMap.get(otherParticipantId.toString()) : null;
        const isMutualMember = otherParticipantId ? mutualSet.has(otherParticipantId.toString()) : false;
        const isBlockedUser = otherParticipantId
          ? (blockedSet.has(otherParticipantId.toString()) || conv.status === "REPORTED")
          : (conv.status === "REPORTED");
        const post = conv.postId ? postMap.get(conv.postId.toString()) : null;
        const product = (conv as any).productId ? productMap.get((conv as any).productId.toString()) : null;

        let categoryName = null;
        if (otherUser && otherUser.businessCategory) {
          categoryName = categoryMap.get(otherUser.businessCategory.toString()) || null;
        }

        const unreadCount = conv.unreadCounts?.[userId.toString()] || 0;

        // Find the latest message visible to current userId
        const msgsInConv = latestMsgMap.get(conv._id.toString()) || [];
        let visibleLastMessage = conv.lastMessage;
        let visibleLastMessageTime = conv.lastMessageTime;
        let visibleLastMessageSenderId = conv.lastMessageSenderId;

        if (msgsInConv.length > 0) {
          let foundVisible = false;
          for (const m of msgsInConv) {
            const rKey = (m.reminderId || m.businessActionId)?.toString();
            const rObj = rKey ? reminderMap.get(rKey) : null;
            const isHiddenSelfReminder = (m.type === MessageType.REMINDER || !!rObj) &&
              rObj?.recipientType === ReminderRecipientType.SELF &&
              m.senderId.toString() !== userId.toString();

            const isBlockedForMe = m.blockedFor && m.blockedFor.some((id: any) => id.toString() === userId.toString());

            if (!isHiddenSelfReminder && !isBlockedForMe) {
              visibleLastMessage = m.content;
              visibleLastMessageTime = m.createdAt;
              visibleLastMessageSenderId = m.senderId;
              foundVisible = true;
              break;
            }
          }
          if (!foundVisible) {
            visibleLastMessage = null as any;
            visibleLastMessageTime = null as any;
            visibleLastMessageSenderId = null as any;
          }
        }

        const effectiveStatus = this.getEffectiveStatus(conv, userIdStr, isMutualMember);

        return {
          ...conv,
          lastMessage: visibleLastMessage,
          lastMessageTime: visibleLastMessageTime,
          lastMessageSenderId: visibleLastMessageSenderId,
          otherUser: otherUser ? {
            _id: otherUser._id,
            fullName: otherUser.fullName,
            profilePhoto: otherUser.profilePhoto,
            categoryName: categoryName,
            isOnline: isBlockedUser ? false : (otherUser.isOnline || false),
            lastSeen: isBlockedUser ? null : (otherUser.lastSeen || null)
          } : null,
          post: post || null,
          product: product || null,
          milestone: conv.milestoneId ? milestoneMap.get(conv.milestoneId.toString()) : null,
          status: effectiveStatus,
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

      const otherId = conversation.participants.find(p => !p.equals(userId));
      const isBlockedMember = otherId
        ? ((conversation.status === "REPORTED") || (await this.isBlocked(userId, otherId)))
        : false;

      // Only mark messages as read if the users are not blocked/reported
      if (!isBlockedMember) {
        await this.messageRepo.updateMany(
          {
            conversationId: new ObjectId(id),
            senderId: { $ne: userId },
            isRead: { $ne: true },
            $or: [
              { blockedFor: { $exists: false } },
              { blockedFor: { $nin: [userId] } }
            ]
          } as any,
          { $set: { isRead: true } } as any
        );

        // Reset unread count for this user
        const unreadCounts = conversation.unreadCounts || {};
        unreadCounts[userId.toString()] = 0;
        conversation.unreadCounts = { ...unreadCounts };
        await this.conversationRepo.save(conversation);

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

      const conversation = await this.conversationRepo.findOneBy({
        _id: new ObjectId(conversationId),
        deletedBy: { $nin: [new ObjectId(req.user.userId)] }
      });
      if (!conversation) throw new NotFoundError("Conversation not found");

      const otherParticipantId = conversation.participants.find(p => !p.equals(new ObjectId(req.user.userId)));
      let otherUser = null;
      if (otherParticipantId) {
        const isBlockedMember = (conversation.status === "REPORTED") || (await this.isBlocked(new ObjectId(req.user.userId), otherParticipantId));
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
            isOnline: isBlockedMember ? false : (user.isOnline || false),
            lastSeen: isBlockedMember ? null : (user.lastSeen || null)
          };
        }
      }

      const userId = new ObjectId(req.user.userId);

      const rawMessages = await this.messageRepo.find({
        where: { conversationId: new ObjectId(conversationId) },
        order: { createdAt: "DESC" }
      });

      const filteredMessages = rawMessages.filter(
        m => !m.blockedFor || !m.blockedFor.some((id: any) => id.toString() === userId.toString())
      );
      const total = filteredMessages.length;
      const messages = filteredMessages.slice(page * limit, (page + 1) * limit);
      const otherParticipant = conversation.participants.find(p => !p.equals(userId));
      const isBlockedWithOther = otherParticipant
        ? ((conversation.status === "REPORTED") || (await this.isBlocked(userId, otherParticipant)))
        : false;

      // Only consider unread messages that are VISIBLE and NOT BLOCKED for this user
      const unreadVisibleMessageIds = messages
        .filter(m => !m.isRead && m.senderId.toString() !== userId.toString() && (!m.blockedFor || !m.blockedFor.some((id: any) => id.toString() === userId.toString())))
        .map(m => m._id);

      if (unreadVisibleMessageIds.length > 0 && !isBlockedWithOther) {
        await this.messageRepo.updateMany(
          {
            _id: { $in: unreadVisibleMessageIds }
          } as any,
          { $set: { isRead: true } } as any
        );

        // Mutate in-memory messages so they are returned as read in this response
        messages.forEach(m => {
          if (unreadVisibleMessageIds.some(id => id.equals(m._id))) {
            m.isRead = true;
          }
        });

        // Reset unread count for this user in the conversation
        const unreadCounts = conversation.unreadCounts || {};
        unreadCounts[userId.toString()] = 0;
        conversation.unreadCounts = { ...unreadCounts };
        await this.conversationRepo.save(conversation);

        // Notify the sender that their messages have been read (skip if blocked or reported)
        if (otherParticipant) {
          const io = getIO();
          const readPayload = { conversationId: conversation._id, readBy: userId, readAt: new Date() };
          io.to(`conversation_${conversation._id}`).emit("messages_read", readPayload);
          io.to(otherParticipant.toString()).emit("messages_read", readPayload);
        }
      }

      // Batch fetch related entities to eliminate N+1 queries
      const postIds = [...new Set(messages.filter(m => (m.type === MessageType.POST_RESPONSE || m.type === MessageType.POST_SHARE) && m.postId).map(m => m.postId!))];
      const productIds = [...new Set(messages.filter(m => m.type === MessageType.PRODUCT_RESPONSE && (m as any).productId).map(m => (m as any).productId!))];
      const milestoneIds = [...new Set(messages.filter(m => m.type === MessageType.MILESTONE_REPLY && m.milestoneId).map(m => m.milestoneId!))];
      const replyToIds = [...new Set(messages.filter(m => m.replyToMessageId).map(m => m.replyToMessageId!))];
      const otoIds = [...new Set(messages.filter(m => m.businessActionId && m.type === MessageType.DIRECT_MEET).map(m => m.businessActionId!))];
      const refIds = [...new Set(messages.filter(m => m.businessActionId && m.type === MessageType.RECOMMENDATIONS).map(m => m.businessActionId!))];
      const tyIds = [...new Set(messages.filter(m => m.businessActionId && m.type === MessageType.BUSINESS_DONE).map(m => m.businessActionId!))];
      const reminderIds = [...new Set(messages.filter(m => (m.type as any) === MessageType.REMINDER || m.reminderId || (m.businessActionId && (m.type as any) === MessageType.REMINDER)).map(m => m.reminderId || m.businessActionId!).filter(id => !!id))];

      const [posts, products, milestones, replyMsgs, otos, refs, tys, reminders] = await Promise.all([
        postIds.length > 0 ? this.postRepo.find({ where: { _id: { $in: postIds } } as any }) : [],
        productIds.length > 0 ? this.productRepo.find({ where: { _id: { $in: productIds } } as any }) : [],
        milestoneIds.length > 0 ? this.milestoneRepo.find({ where: { _id: { $in: milestoneIds } } as any }) : [],
        replyToIds.length > 0 ? this.messageRepo.find({ where: { _id: { $in: replyToIds } } as any }) : [],
        otoIds.length > 0 ? this.oneToOneRepo.find({ where: { _id: { $in: otoIds } } as any }) : [],
        refIds.length > 0 ? this.referralRepo.find({ where: { _id: { $in: refIds } } as any }) : [],
        tyIds.length > 0 ? this.tySlipRepo.find({ where: { _id: { $in: tyIds } } as any }) : [],
        reminderIds.length > 0 ? this.reminderRepo.find({ where: { _id: { $in: reminderIds } } as any }) : []
      ]);

      const postMap = new Map(posts.map(p => [p._id.toString(), p]));
      const productMap = new Map(products.map(p => [p._id.toString(), p]));
      const milestoneMap = new Map(milestones.map(m => [m._id.toString(), m]));
      const replyMap = new Map(replyMsgs.map(m => [m._id.toString(), m]));
      const otoMap = new Map(otos.map(o => [o._id.toString(), o]));
      const refMap = new Map(refs.map(r => [r._id.toString(), r]));
      const tyMap = new Map(tys.map(t => [t._id.toString(), t]));
      const reminderMap = new Map(reminders.map(r => [r._id.toString(), r]));

      const populatedMessages: any[] = [];
      for (const msg of messages) {
        if (msg.isDeleted) {
          populatedMessages.push({
            _id: msg._id,
            conversationId: msg.conversationId,
            senderId: msg.senderId,
            content: "This conversation marked as deleted",
            isDeleted: true,
            isRead: msg.isRead || false,
            isMe: msg.senderId.toString() === req.user.userId,
            createdAt: msg.createdAt
          });
          continue;
        }

        const reminderKey = (msg.reminderId || msg.businessActionId)?.toString();
        const reminderObj = reminderKey ? reminderMap.get(reminderKey) : null;

        // Visibility check: If reminder recipientType is 'self' and logged-in user is NOT the sender, hide this reminder message from recipient
        if ((msg.type as any) === MessageType.REMINDER || reminderObj) {
          if (reminderObj && reminderObj.recipientType === ReminderRecipientType.SELF && msg.senderId.toString() !== req.user.userId) {
            continue;
          }
        }

        const result: any = {
          ...msg,
          isMe: msg.senderId.toString() === req.user.userId,
          isRead: msg.isRead || false,
          post: null,
          replyTo: null,
          media: msg.media || [],
          businessActionId: msg.businessActionId || null,
          reminder: reminderObj || null
        };

        if ((msg.type === MessageType.POST_RESPONSE || msg.type === MessageType.POST_SHARE) && msg.postId) {
          result.post = postMap.get(msg.postId.toString()) || null;
        }

        if (msg.type === MessageType.PRODUCT_RESPONSE && (msg as any).productId) {
          result.product = productMap.get((msg as any).productId.toString()) || null;
        }

        if (msg.type === MessageType.MILESTONE_REPLY && msg.milestoneId) {
          result.milestone = milestoneMap.get(msg.milestoneId.toString()) || null;
        }

        if (msg.replyToMessageId) {
          const repliedMsg = replyMap.get(msg.replyToMessageId.toString());
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
          const baKey = msg.businessActionId.toString();
          if (msg.type === MessageType.DIRECT_MEET) {
            result.businessAction = otoMap.get(baKey) || null;
          } else if (msg.type === MessageType.RECOMMENDATIONS) {
            result.businessAction = refMap.get(baKey) || null;
          } else if (msg.type === MessageType.BUSINESS_DONE) {
            result.businessAction = tyMap.get(baKey) || null;
          } else if ((msg.type as any) === MessageType.REMINDER) {
            result.businessAction = reminderMap.get(baKey) || null;
          }
        }

        populatedMessages.push(result);
      }

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
      // Check if conversation has been reported
      // if (conversation.status === "REPORTED" && status !== "REPORTED" && status !== "DELETED") {
      //   throw new BadRequestError("This conversation has been reported and its status cannot be changed");
      // }

      // Check if conversation is pending and receiver is accepting
      if (status !== "ACCEPTED" && status !== "DELETED" && status !== "REPORTED") {
        const otherParticipantId = conversation.participants.find(p => !p.equals(userId));
        const isMutualConnection = otherParticipantId ? await this.isMutual(userId, otherParticipantId) : false;
        if (!isMutualConnection) {
          if (
            conversation.status === "PENDING" &&
            conversation?.lastMessageSenderId &&
            !conversation.lastMessageSenderId.equals(userId)
          ) {
            throw new BadRequestError("Please accept the request");
          }
          if (conversation.status === "PENDING") {
            throw new BadRequestError("Request is pending. Please wait.");
          }
        }
      }

      if (status === "ACCEPTED") {
        conversation.status = "ACCEPTED";
        conversation.isDeleted = false;
        delete conversation.deletedBy;
        if (!conversation.userStatuses) conversation.userStatuses = {};
        conversation.userStatuses[userId.toString()] = "ACCEPTED";
        delete (conversation as any).statusUpdatedBy;
      } else if (status === "DELETED") {
        conversation.deletedBy = userId;
        conversation.isDeleted = true;
        conversation.status = "DELETED";
        if (!conversation.userStatuses) conversation.userStatuses = {};
        conversation.userStatuses[userId.toString()] = "DELETED";
        conversation.statusUpdatedBy = userId;
      } else if (status === "REPORTED") {
        conversation.status = "REPORTED";
        conversation.reportedBy = userId;
        conversation.reportReason = reason;
        if (!conversation.userStatuses) conversation.userStatuses = {};
        conversation.userStatuses[userId.toString()] = "REPORTED";

        const otherId = conversation.participants.find(p => !p.equals(userId));
        if (otherId) {
          const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
          const existingReport = await reportedHistoryRepo.findOne({
            where: { reporterUserId: userId, targetUserId: otherId } as any
          });
          if (existingReport) {
            throw new BadRequestError("You have already reported this user");
          }
          if (!existingReport) {
            const report = new ReportedHistory();
            report.reporterUserId = userId;
            report.targetUserId = otherId;
            report.moduleName = "CONVERSATION";
            report.reason = reason || "Reported User in Conversation";
            await reportedHistoryRepo.save(report);
          }
        }
      } else {
        // Personal categorization (like pinned / folder tag: USEFUL, MAY_BE_LATER, MAYBE_LATER, REJECTED)
        // Store strictly for this user in userStatuses map
        if (!conversation.userStatuses) conversation.userStatuses = {};
        conversation.userStatuses[userId.toString()] = status;
        conversation.statusUpdatedBy = userId;
        // Keep conversation.status as ACCEPTED if pending, without altering other participant's state
        if (conversation.status === "PENDING") {
          conversation.status = "ACCEPTED";
        }
      }

      await this.conversationRepo.save(conversation);

      const otherId = conversation.participants.find(p => !p.equals(userId));

      // If status is ACCEPTED, notify the other participant that request is accepted
      if (status === "ACCEPTED" && otherId) {
        getIO().to(otherId.toString()).emit("conversation_status_updated", {
          conversationId: conversation._id,
          status: "ACCEPTED"
        });
      }

      // Always emit to the updating user with their own status
      getIO().to(userId.toString()).emit("conversation_status_updated", {
        conversationId: conversation._id,
        status: status
      });

      const responseData = {
        ...conversation,
        status: status
      };

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Conversation status updated",
        data: responseData
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

      if (post.isActive === false || post.status === "inactive" || post.status === "deactivated") {
        throw new BadRequestError("This post has been deactivated and can no longer receive responses");
      }

      if (post.type === PostType.REQUIREMENT) {
        await validateRequirementResponseLimit(senderId);
      }

      // Increment response count
      post.responsedCount = (post.responsedCount || 0) + 1;

      // Deactivate Requirement, Give posts if response count reaches 10
      const autoDeactivateTypes = [PostType.REQUIREMENT, PostType.GIVE];
      if (autoDeactivateTypes.includes(post.type) && post.responsedCount >= 10) {
        post.isActive = false;
        post.status = "inactive";
        post.statusReason = "Deactivated: Reached maximum limit of 10 responses";
      }

      await this.postRepo.save(post);

      const receiverId = post.memberId;
      if (senderId.equals(receiverId)) throw new BadRequestError("You cannot respond to your own post");

      const isBlockedMember = await this.isBlocked(senderId, receiverId);

      let conversation = await this.getOrCreateConversation(senderId, receiverId);
      conversation.postId = new ObjectId(postId);

      // Check if sender already responded or shared this post in this conversation
      const existingResponse = await this.messageRepo.findOne({
        where: {
          conversationId: conversation._id,
          senderId: senderId,
          postId: new ObjectId(postId),
          type: { $in: [MessageType.POST_RESPONSE, MessageType.POST_SHARE] },
          isDeleted: { $ne: true }
        } as any
      });

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = message || "Hi, I'm interested in your post.";
      newMessage.type = existingResponse ? MessageType.TEXT : MessageType.POST_RESPONSE;
      newMessage.postId = new ObjectId(postId);
      newMessage.isDeleted = false;
      newMessage.isRead = false;
      if (isBlockedMember && receiverId) {
        newMessage.blockedFor = [receiverId];
      }
      // Check if receiver is in the chat room
      const isReceiverActive = !isBlockedMember && isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      // Send Push Notification if receiver is not active in the chat room and has fcmToken (skip if blocked/reported)
      const receiver = await this.memberRepo.findOneBy({ _id: receiverId, isDeleted: false });
      if (!isBlockedMember && !isReceiverActive && receiver?.fcmToken) {
        const isMutualMember = await this.isMutual(senderId, receiverId);
        // const sender = await this.memberRepo.findOneBy({ _id: senderId });
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: `New Message for ${post.title}`,
          content: newMessage.content,
          moduleName: isMutualMember ? NotificationModule.MESSAGE : NotificationModule.MESSAGE_REQUEST,
          moduleId: conversation._id.toString(),
          receiverId: receiverId.toString(),
          senderId: senderId.toString()
        });
      }

      conversation.lastMessage = newMessage.content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      // Update unread count for receiver only if not blocked
      if (!isBlockedMember) {
        const unreadCounts = conversation.unreadCounts || {};
        if (isReceiverActive) {
          unreadCounts[receiverId.toString()] = 0;
        } else {
          unreadCounts[receiverId.toString()] = (unreadCounts[receiverId.toString()] || 0) + 1;
        }
        conversation.unreadCounts = { ...unreadCounts };
      }

      await this.conversationRepo.save(conversation);

      const io = getIO();
      if (!isBlockedMember) {
        io.to(receiverId.toString()).emit("new_message", {
          ...savedMessage,
          post
        });

        // Emit conversation update for receiver
        const sender = await this.memberRepo.findOneBy({ _id: senderId });
        let senderCategoryName = null;
        if (sender && sender.businessCategory) {
          const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
          senderCategoryName = cat ? cat.name : null;
        }

        const unreadCount = conversation.unreadCounts?.[receiverId.toString()] || 0;

        io.to(receiverId.toString()).emit("conversation_updated", {
          ...conversation,
          status: this.getEffectiveStatus(conversation, receiverId.toString()),
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
      }

      // Emit conversation update to sender
      const receiverMember = await this.memberRepo.findOneBy({ _id: receiverId });
      let receiverCategoryName = null;
      if (receiverMember && receiverMember.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: receiverMember.businessCategory });
        receiverCategoryName = cat ? cat.name : null;
      }
      io.to(senderId.toString()).emit("conversation_updated", {
        ...conversation,
        status: this.getEffectiveStatus(conversation, senderId.toString()),
        lastMessage: savedMessage.content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: savedMessage.senderId,
        otherUser: receiverMember ? {
          _id: receiverMember._id,
          fullName: receiverMember.fullName,
          profilePhoto: receiverMember.profilePhoto,
          categoryName: receiverCategoryName,
          isOnline: receiverMember.isOnline || false,
          lastSeen: receiverMember.lastSeen || null
        } : null,
        post: post || null,
        unreadCount: conversation.unreadCounts?.[senderId.toString()] || 0
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

      const isBlockedMember = await this.isBlocked(senderId, receiverId);

      let conversation = await this.getOrCreateConversation(senderId, receiverId);
      (conversation as any).productId = new ObjectId(productId);

      // Check if sender already responded to this product in this conversation
      const existingResponse = await this.messageRepo.findOne({
        where: {
          conversationId: conversation._id,
          senderId: senderId,
          type: MessageType.PRODUCT_RESPONSE,
          productId: new ObjectId(productId),
          isDeleted: { $ne: true }
        } as any
      });

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = message || "Hi, I'm interested in your product.";
      newMessage.type = existingResponse ? MessageType.TEXT : MessageType.PRODUCT_RESPONSE;
      (newMessage as any).productId = new ObjectId(productId);
      newMessage.isRead = false;
      if (isBlockedMember && receiverId) {
        newMessage.blockedFor = [receiverId];
      }
      // Check if receiver is in the chat room
      const isReceiverActive = !isBlockedMember && isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      // Send Push Notification if receiver is not active in the chat room and has fcmToken (skip if blocked/reported)
      const receiver = await this.memberRepo.findOneBy({ _id: receiverId, isDeleted: false });
      if (!isBlockedMember && !isReceiverActive && receiver?.fcmToken) {
        const isMutualMember = await this.isMutual(senderId, receiverId);
        // const sender = await this.memberRepo.findOneBy({ _id: senderId });
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: "New Message for product - " + product.productName,
          content: newMessage.content,
          moduleName: isMutualMember ? NotificationModule.MESSAGE : NotificationModule.MESSAGE_REQUEST,
          moduleId: conversation._id.toString(),
          receiverId: receiverId.toString(),
          senderId: senderId.toString()
        });
      }

      conversation.lastMessage = newMessage.content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      // Update unread count for receiver only if not blocked
      if (!isBlockedMember) {
        const unreadCounts = conversation.unreadCounts || {};
        if (isReceiverActive) {
          unreadCounts[receiverId.toString()] = 0;
        } else {
          unreadCounts[receiverId.toString()] = (unreadCounts[receiverId.toString()] || 0) + 1;
        }
        conversation.unreadCounts = { ...unreadCounts };
      }

      await this.conversationRepo.save(conversation);

      const io = getIO();
      if (!isBlockedMember) {
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
          status: this.getEffectiveStatus(conversation, receiverId.toString()),
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
      }

      // Emit conversation update to sender
      const receiverMember = await this.memberRepo.findOneBy({ _id: receiverId });
      let receiverCategoryName = null;
      if (receiverMember && receiverMember.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: receiverMember.businessCategory });
        receiverCategoryName = cat ? cat.name : null;
      }
      io.to(senderId.toString()).emit("conversation_updated", {
        ...conversation,
        status: this.getEffectiveStatus(conversation, senderId.toString()),
        lastMessage: savedMessage.content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: savedMessage.senderId,
        otherUser: receiverMember ? {
          _id: receiverMember._id,
          fullName: receiverMember.fullName,
          profilePhoto: receiverMember.profilePhoto,
          categoryName: receiverCategoryName,
          isOnline: receiverMember.isOnline || false,
          lastSeen: receiverMember.lastSeen || null
        } : null,
        product: product || null,
        unreadCount: conversation.unreadCounts?.[senderId.toString()] || 0
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
   *                 enum: [TEXT, IMAGE, DIRECT_MEET, RECOMMENDATIONS, BUSINESS_DONE]
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
      console.log(JSON.stringify(data), "datadata");
      const senderId = new ObjectId(req.user.userId);
      let pointsResult = { awarded: 0, balance: 0 };
      let { conversationId, content, type = MessageType.TEXT, replyToMessageId, media, businessActionId, actionData } = data;

      if (!conversationId && (data as any).receiverId && ObjectId.isValid((data as any).receiverId)) {
        const recId = new ObjectId((data as any).receiverId);
        const conv = await this.getOrCreateConversation(senderId, recId);
        conversationId = conv._id.toString();
      }

      if (!conversationId || !ObjectId.isValid(conversationId)) throw new BadRequestError("Invalid Conversation ID");

      const conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(conversationId) });
      if (!conversation) throw new NotFoundError("Conversation not found");

      const receiverId = conversation.participants.find(p => !p.equals(senderId));
      if (!receiverId) throw new BadRequestError("No receiver found in this conversation");

      const isMutualConnection = await this.isMutual(senderId, receiverId);

      const wasRejectedOrDeleted =
        conversation.status === "REJECTED" ||
        conversation.status === "DELETED" ||
        conversation.isDeleted ||
        !!conversation.deletedBy;

      if (wasRejectedOrDeleted) {
        conversation.isDeleted = false;
        delete conversation.deletedBy;
        conversation.userStatuses = {};
        delete (conversation as any).statusUpdatedBy;
        conversation.status = "PENDING";
        await this.conversationRepo.save(conversation);
      } else if (conversation.status === "PENDING" && isMutualConnection) {
        conversation.status = "ACCEPTED";
        await this.conversationRepo.save(conversation);
      }

      const isBlockedMember = (conversation.status === "REPORTED") || (await this.isBlocked(senderId, receiverId));

      // Auto-generate content for Business Actions if missing
      if (!content) {
        if (type === MessageType.DIRECT_MEET) content = "Direct Meet Completed";
        else if (type === MessageType.RECOMMENDATIONS) content = "Shared a Recommendation";
        else if (type === MessageType.BUSINESS_DONE) content = "Business Done";
        else if (type === MessageType.REMINDER) content = actionData?.title ? `Reminder: ${actionData.title}` : "Created a Reminder";
        else if (type === MessageType.IMAGE) content = "Sent an Image";
        else content = "";
      }
      if (type === MessageType.RECOMMENDATIONS) {
        const contact = new Contact();
        contact.name = actionData.name;
        contact.phoneNumber = actionData.phone;
        contact.type = ContactType.REFERRED;
        contact.createdBy = senderId;
        contact.modifiedBy = senderId;
        contact.isActive = true;
        contact.isDeleted = false;
        contact.referredBy = receiverId;
        contact.status = ReferralStatus.NOT_CONTACTED;
        await this.contactRepo.save(contact);
      }

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = content;
      newMessage.type = type;
      newMessage.isRead = false;
      if (isBlockedMember && receiverId) {
        newMessage.blockedFor = [receiverId];
      }

      // Check if receiver is in the chat room
      const isReceiverActive = !isBlockedMember && isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      // Handle Automatic Business Action Creation
      if ([MessageType.DIRECT_MEET, MessageType.RECOMMENDATIONS, MessageType.BUSINESS_DONE].includes(type)) {
        let _moduleName = "";
        if (type === MessageType.DIRECT_MEET) _moduleName = "Direct Meet";
        else if (type === MessageType.RECOMMENDATIONS) _moduleName = "Recommendations";
        else if (type === MessageType.BUSINESS_DONE) _moduleName = "Business Done";
        // await validateModuleUsage(senderId, moduleName);
        if (type === MessageType.DIRECT_MEET) {
          const oto = new OneToOne();
          oto.senderId = senderId;
          oto.receiverId = receiverId;
          oto.media = media; // Store the screenshot in the business record too
          oto.conversationId = conversation._id;
          const savedOto = await this.oneToOneRepo.save(oto);
          newMessage.businessActionId = savedOto._id;

          // Award Points (Response type for Direct Meet)
          try {
            const pointService = new PointService();
            pointsResult = await pointService.awardPoints({
              memberId: senderId,
              moduleName: "Direct Meet",
              type: PointConfigType.CREATION,
              referenceId: savedOto._id
            });
          } catch (pointError) {
            console.error("Failed to award points for Direct Meet:", pointError);
          }
        } else if (type === MessageType.RECOMMENDATIONS) {
          const ref = new Referral();
          ref.senderId = senderId;
          ref.receiverId = receiverId;
          ref.referralName = actionData.referralName || actionData.name;
          ref.referralMobile = actionData.referralMobile || actionData.phone;
          ref.referralEmail = actionData.referralEmail || actionData.email;
          ref.location = actionData.location;
          ref.comments = actionData.comments;
          ref.status = ReferralStatus.NOT_CONTACTED;
          ref.conversationId = conversation._id;
          const savedRef = await this.referralRepo.save(ref);
          newMessage.businessActionId = savedRef._id;

          // Award Points (Creation type for Recommendations)
          try {
            const pointService = new PointService();
            pointsResult = await pointService.awardPoints({
              memberId: senderId,
              moduleName: "Recommendations",
              type: PointConfigType.CREATION,
              referenceId: savedRef._id
            });
          } catch (pointError) {
            console.error("Failed to award points for Recommendations:", pointError);
          }
        } else if (type === MessageType.BUSINESS_DONE) {
          const ty = new ThankYouSlip();
          ty.senderId = senderId;
          ty.receiverId = receiverId;
          ty.amount = Number(actionData.amount) || Number(actionData.businessAmount) || 0;
          ty.businessDetails = actionData.businessDetails || actionData.remarks || "";
          ty.conversationId = conversation._id;
          const savedTy = await this.tySlipRepo.save(ty);
          newMessage.businessActionId = savedTy._id;

          // Award Points (Creation type for Business Done)
          try {
            const pointService = new PointService();
            pointsResult = await pointService.awardPoints({
              memberId: receiverId,
              moduleName: "Business Done",
              type: PointConfigType.RESPONSE,
              referenceId: savedTy._id
            });
          } catch (pointError) {
            console.error("Failed to award points for Business Done:", pointError);
          }
        } else if (type === MessageType.REMINDER && actionData) {
          const reminderService = new ReminderService();
          const reminderData = {
            ...actionData,
            conversationId: conversation._id.toString(),
            receiverId: receiverId.toString()
          };
          const reminder = await reminderService.createReminder(reminderData, senderId.toString());
          newMessage.reminderId = reminder._id;
          newMessage.businessActionId = reminder._id;
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

      const isSelfReminder = type === MessageType.REMINDER && (
        actionData?.recipientType === ReminderRecipientType.SELF ||
        actionData?.recipientType === "self" ||
        !actionData?.recipientType
      );

      // Send Push Notification if receiver is not active in the chat room and has fcmToken (skip if self reminder or blocked/reported)
      const receiver = await this.memberRepo.findOneBy({ _id: receiverId, isDeleted: false });
      if (!isBlockedMember && !isSelfReminder && !isReceiverActive && receiver?.fcmToken) {
        const sender = await this.memberRepo.findOneBy({ _id: senderId, isDeleted: false });
        const senderName = sender?.fullName ? sender.fullName.trim() : "A member";

        let notificationModule = NotificationModule.MESSAGE;
        let subject = `New Message from ${senderName}`;
        let notificationContent = newMessage.content;

        if (type === MessageType.DIRECT_MEET) {
          notificationModule = NotificationModule.DIRECT_MEET;
          subject = "Direct Meet Update";
          notificationContent = `${senderName} has registered a direct meeting with you.  we made valuable conversation!`;
        } else if (type === MessageType.RECOMMENDATIONS) {
          notificationModule = NotificationModule.RECOMMENDATIONS;
          subject = "New Referral Received";
          notificationContent = `${senderName} shared a business referral with you. Check the referral details and connect.`;
        } else if (type === MessageType.BUSINESS_DONE) {
          notificationModule = NotificationModule.BUSINESS_DONE;
          subject = "Business Closed";
          notificationContent = `${senderName} marked the business as successfully completed. Congratulations on the new business connection! 🎉`;
        }

        await insertPushNotification({
          token: receiver.fcmToken,
          subject,
          content: notificationContent,
          moduleName: notificationModule,
          moduleId: conversation._id.toString(),
          receiverId: receiverId.toString(),
          senderId: senderId.toString()
        });
      }

      if (!isSelfReminder) {
        conversation.lastMessage = content;
        conversation.lastMessageTime = new Date();
        conversation.lastMessageSenderId = senderId;

        // Update unread count for receiver only if not blocked
        if (!isBlockedMember) {
          const unreadCounts = conversation.unreadCounts || {};
          if (isReceiverActive) {
            unreadCounts[receiverId.toString()] = 0;
          } else {
            unreadCounts[receiverId.toString()] = (unreadCounts[receiverId.toString()] || 0) + 1;
          }
          conversation.unreadCounts = { ...unreadCounts };
        }
      }

      await this.conversationRepo.save(conversation);

      const io = getIO();

      // Prepare fully populated message for the socket
      const populatedMessage: any = {
        ...savedMessage,
        isMe: false,
        businessAction: null
      };

      if (savedMessage.businessActionId) {
        if (savedMessage.type === MessageType.DIRECT_MEET) {
          populatedMessage.businessAction = await this.oneToOneRepo.findOneBy({ _id: savedMessage.businessActionId });
        } else if (savedMessage.type === MessageType.RECOMMENDATIONS) {
          populatedMessage.businessAction = await this.referralRepo.findOneBy({ _id: savedMessage.businessActionId });
        } else if (savedMessage.type === MessageType.BUSINESS_DONE) {
          populatedMessage.businessAction = await this.tySlipRepo.findOneBy({ _id: savedMessage.businessActionId });
        }
      }

      if (!isSelfReminder && !isBlockedMember) {
        io.to(`conversation_${conversation._id}`).emit("new_message", populatedMessage);
      }

      // Always emit to sender
      io.to(senderId.toString()).emit("new_message", {
        ...populatedMessage,
        isMe: true
      });

      if (receiverId && !isSelfReminder && !isBlockedMember) {
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
          status: this.getEffectiveStatus(conversation, receiverId.toString()),
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

      // Emit conversation_updated to sender
      const receiverMember = await this.memberRepo.findOneBy({ _id: receiverId });
      let receiverCategoryName = null;
      if (receiverMember && receiverMember.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: receiverMember.businessCategory });
        receiverCategoryName = cat ? cat.name : null;
      }
      io.to(senderId.toString()).emit("conversation_updated", {
        ...conversation,
        status: this.getEffectiveStatus(conversation, senderId.toString()),
        lastMessage: savedMessage.content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: savedMessage.senderId,
        otherUser: receiverMember ? {
          _id: receiverMember._id,
          fullName: receiverMember.fullName,
          profilePhoto: receiverMember.profilePhoto,
          categoryName: receiverCategoryName,
          isOnline: receiverMember.isOnline || false,
          lastSeen: receiverMember.lastSeen || null
        } : null,
        unreadCount: conversation.unreadCounts?.[senderId.toString()] || 0
      });

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
      message.content = "This conversation marked as deleted";
      if ((message as any).media) delete (message as any).media;
      await this.messageRepo.save(message);

      const conversation = await this.conversationRepo.findOneBy({ _id: message.conversationId });
      if (conversation) {
        // Find the latest message for this conversation to update lastMessage
        const latestMessage = await this.messageRepo.findOne({
          where: { conversationId: conversation._id } as any,
          order: { createdAt: "DESC" }
        });

        if (latestMessage) {
          if (latestMessage.isDeleted) {
            conversation.lastMessage = "This conversation marked as deleted";
          } else {
            conversation.lastMessage = latestMessage.content || (latestMessage.media && (latestMessage.media as any).length > 0 ? "📷 Photo" : "");
          }
          conversation.lastMessageTime = latestMessage.createdAt;
          conversation.lastMessageSenderId = latestMessage.senderId;
          await this.conversationRepo.save(conversation);
        }

        const io = getIO();
        const deletedPayload = {
          messageId: message._id.toString(),
          conversationId: conversation._id.toString(),
          content: "This conversation marked as deleted",
          isDeleted: true
        };

        const convUpdatePayload = {
          conversationId: conversation._id.toString(),
          lastMessage: conversation.lastMessage,
          lastMessageTime: conversation.lastMessageTime,
          lastMessageSenderId: conversation.lastMessageSenderId?.toString()
        };

        // 1. Emit to specific conversation room
        io.to(`conversation_${conversation._id}`).emit("message_deleted", deletedPayload);
        io.to(`conversation_${conversation._id}`).emit("conversation_updated", convUpdatePayload);

        // 2. Emit to all participant personal rooms
        for (const participantId of conversation.participants || []) {
          const pStr = participantId.toString();
          io.to(pStr).emit("message_deleted", deletedPayload);
          io.to(pStr).emit("conversation_updated", convUpdatePayload);
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
    @Body() data: { receiverId: string; notificationId: string },
    @Res() res: any
  ) {
    try {
      const senderId = new ObjectId(req.user.userId);
      const { receiverId, notificationId } = data;

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

      const isBlockedMember = await this.isBlocked(senderId, recId);

      let conversation = await this.getOrCreateConversation(senderId, recId);

      const content = "Happy Birthday! 🎂🎉";

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = senderId;
      newMessage.content = content;
      newMessage.type = MessageType.TEXT;
      newMessage.isDeleted = false;
      newMessage.isRead = false;

      // Check if receiver is in the chat room
      const isReceiverActive = !isBlockedMember && isUserInConversation(recId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);
      await this.pushNotificationRepo.delete({ _id: new ObjectId(notificationId) });

      // Update conversation details
      conversation.lastMessage = content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = senderId;

      if (!isBlockedMember) {
        const unreadCounts = conversation.unreadCounts || {};
        if (isReceiverActive) {
          unreadCounts[recId.toString()] = 0;
        } else {
          unreadCounts[recId.toString()] = (unreadCounts[recId.toString()] || 0) + 1;
        }
        conversation.unreadCounts = { ...unreadCounts };
      }

      await this.conversationRepo.save(conversation);

      // Emit sockets
      const io = getIO();
      const populatedMessage = {
        ...savedMessage,
        isMe: false,
        businessAction: null
      };

      if (!isBlockedMember) {
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
          status: this.getEffectiveStatus(conversation, recId.toString()),
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
      }

      // Emit conversation_updated to sender
      const receiverMember = await this.memberRepo.findOneBy({ _id: recId });
      let receiverCategoryName = null;
      if (receiverMember && receiverMember.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: receiverMember.businessCategory });
        receiverCategoryName = cat ? cat.name : null;
      }
      io.to(senderId.toString()).emit("conversation_updated", {
        ...conversation,
        lastMessage: content,
        lastMessageTime: savedMessage.createdAt,
        lastMessageSenderId: senderId,
        otherUser: receiverMember ? {
          _id: receiverMember._id,
          fullName: receiverMember.fullName,
          profilePhoto: receiverMember.profilePhoto,
          categoryName: receiverCategoryName,
          isOnline: receiverMember.isOnline || false,
          lastSeen: receiverMember.lastSeen || null
        } : null,
        unreadCount: conversation.unreadCounts?.[senderId.toString()] || 0
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
