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
import { PostModel } from "../../entity/Post";
import { Category } from "../../entity/Category";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Milestone } from "../../entity/Milestone";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { getIO, isUserInConversation } from "../../utils/socket";
import { pagination } from "../../utils";

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
   *     security:
   *       - bearerAuth: []
   */
  @Get("/conversations")
  async getConversations(
    @Req() req: any,
    @QueryParam("page") page: number = 0,
    @QueryParam("limit") limit: number = 20,
    @Res() res: any
  ) {
    try {
      const userId = new ObjectId(req.user.userId);

      const [conversations, total] = await this.conversationRepo.findAndCount({
        where: { participants: { $all: [userId] } } as any,
        order: { updatedAt: "DESC" },
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

      const results = conversations.map(conv => {
        const otherParticipantId = conv.participants.find(p => !p.equals(userId));
        const otherUser = otherParticipantId ? memberMap.get(otherParticipantId.toString()) : null;
        const post = conv.postId ? postMap.get(conv.postId.toString()) : null;

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
            categoryName: categoryName
          } : null,
          post: post || null,
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
            categoryName: categoryName
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

      const populatedMessages = await Promise.all(messages.map(async (msg) => {
        if (msg.isDeleted) {
          return {
            _id: msg._id,
            conversationId: msg.conversationId,
            senderId: msg.senderId,
            content: "This message was deleted",
            isDeleted: true,
            isMe: msg.senderId.toString() === req.user.userId,
            createdAt: msg.createdAt
          };
        }

        const result: any = {
          ...msg,
          isMe: msg.senderId.toString() === req.user.userId,
          post: null,
          replyTo: null,
          media: msg.media || [],
          businessActionId: msg.businessActionId || null
        };

        if ((msg.type === MessageType.POST_RESPONSE || msg.type === MessageType.POST_SHARE) && msg.postId) {
          result.post = await this.postRepo.findOneBy({ _id: msg.postId });
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

      conversation.status = status;
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

      // Increment response count
      post.responsedCount = (post.responsedCount || 0) + 1;
      await this.postRepo.save(post);

      const receiverId = post.memberId;
      if (senderId.equals(receiverId)) throw new BadRequestError("You cannot respond to your own post");

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
        conversation = await this.conversationRepo.save(conversation);
      } else {
        // Check if sender already responded to this post in this conversation
        const existingResponse = await this.messageRepo.findOne({
          where: {
            conversationId: conversation._id,
            senderId: senderId,
            type: MessageType.POST_RESPONSE,
            postId: new ObjectId(postId)
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

      // Check if receiver is in the chat room
      const isReceiverActive = isUserInConversation(receiverId.toString(), conversation._id.toString());
      if (isReceiverActive) {
        newMessage.isRead = true;
      }

      const savedMessage = await this.messageRepo.save(newMessage);

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
          categoryName: senderCategoryName
        } : null,
        post: post || null,
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
      let { conversationId, content, type = MessageType.TEXT, replyToMessageId, media, businessActionId, actionData } = data;

      if (!ObjectId.isValid(conversationId)) throw new BadRequestError("Invalid Conversation ID");

      const conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(conversationId) });
      if (!conversation) throw new NotFoundError("Conversation not found");

      const receiverId = conversation.participants.find(p => !p.equals(senderId));
      if (!receiverId) throw new BadRequestError("No receiver found in this conversation");

      // Auto-generate content for Business Actions if missing
      if (!content) {
        if (type === MessageType.ONE_TO_ONE) content = "One to One Completed";
        else if (type === MessageType.REFERRAL) content = "Shared a Referral";
        else if (type === MessageType.THANK_YOU_SLIP) content = "Sent a Thank You Slip";
        else if (type === MessageType.IMAGE) content = "Sent an Image";
        else content = "";
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
        console.log(type === MessageType.ONE_TO_ONE, "type === MessageType.ONE_TO_ONE");

        if (type === MessageType.ONE_TO_ONE) {
          console.log("sssssssssscc   ");

          const oto = new OneToOne();
          oto.senderId = senderId;
          oto.receiverId = receiverId;
          oto.media = media; // Store the screenshot in the business record too
          const savedOto = await this.oneToOneRepo.save(oto);
          console.log(savedOto, "savedOto");

          newMessage.businessActionId = savedOto._id;
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
        } else if (type === MessageType.THANK_YOU_SLIP) {
          const ty = new ThankYouSlip();
          ty.senderId = senderId;
          ty.receiverId = receiverId;
          ty.amount = Number(actionData.amount) || Number(actionData.businessAmount) || 0;
          ty.businessDetails = actionData.businessDetails || actionData.remarks || content;
          const savedTy = await this.tySlipRepo.save(ty);
          newMessage.businessActionId = savedTy._id;
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
            categoryName: senderCategoryName
          } : null,
          unreadCount
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: savedMessage
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
}
