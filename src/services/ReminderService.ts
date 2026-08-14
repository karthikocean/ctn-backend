import { AppDataSource } from "../data-source";
import { NotifyBy, Reminder, ReminderRecipientType, ReminderStatus, RepeatType } from "../entity/Reminder";
import { Message, MessageType } from "../entity/Message";
import { Conversation } from "../entity/Conversation";
import { Member } from "../entity/Member";
import { CreateReminderDto } from "../dto/mobile/CreateReminderDto";
import { UpdateReminderDto } from "../dto/mobile/UpdateReminderDto";
import { ReminderListDto } from "../dto/mobile/ReminderListDto";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "routing-controllers";
import { getIO, isUserInConversation } from "../utils/socket";
import { insertPushNotification } from "./pushnotification.service";
import { NotificationModule } from "../entity/PushNotifications";

export class ReminderService {
  private reminderRepo = AppDataSource.getMongoRepository(Reminder);
  private conversationRepo = AppDataSource.getMongoRepository(Conversation);
  private messageRepo = AppDataSource.getMongoRepository(Message);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  private validateObjectId(id: string, fieldName: string): ObjectId {
    if (!id || !ObjectId.isValid(id)) {
      throw new BadRequestError(`Invalid ObjectId format for field: ${fieldName}`);
    }
    return new ObjectId(id);
  }

  async createReminder(data: CreateReminderDto, userId: string): Promise<Reminder> {
    const creatorId = this.validateObjectId(userId, "userId");

    const reminder = new Reminder();
    reminder.title = data.title;
    reminder.description = data.description;

    reminder.reminderDate = new Date(data.reminderDate);
    if (isNaN(reminder.reminderDate.getTime())) {
      throw new BadRequestError("Invalid reminderDate format.");
    }

    reminder.reminderTime = data.reminderTime;
    reminder.repeatType = RepeatType.ONCE;
    reminder.repeatInterval = data.repeatInterval || 1;
    reminder.status = ReminderStatus.PENDING;
    reminder.isActive = true;
    reminder.isDeleted = false;
    reminder.nextReminderDate = new Date(reminder.reminderDate);
    reminder.createdBy = creatorId;
    reminder.updatedBy = creatorId;
    reminder.notifyBy = NotifyBy.PUSH as any;
    reminder.recipientType = data.recipientType || ReminderRecipientType.SELF;
    reminder.conversationId = new ObjectId(data.conversationId);

    let receiverObjId: ObjectId | null = null;
    if (data.receiverId) {
      receiverObjId = this.validateObjectId(data.receiverId, "receiverId");
    }

    if (reminder.recipientType === ReminderRecipientType.SELF) {
      reminder.recipients = [creatorId];
    } else if (reminder.recipientType === ReminderRecipientType.OTHER) {
      reminder.recipients = receiverObjId ? [receiverObjId] : [creatorId];
    } else if (reminder.recipientType === ReminderRecipientType.BOTH) {
      reminder.recipients = receiverObjId
        ? Array.from(new Set([creatorId.toString(), receiverObjId.toString()])).map(id => new ObjectId(id))
        : [creatorId];
    } else {
      reminder.recipients = [creatorId];
    }

    const savedReminder = await this.reminderRepo.save(reminder);

    // If conversationId or receiverId is provided, also insert a chat message
    let conversation: Conversation | null = null;
    if (data.conversationId && ObjectId.isValid(data.conversationId)) {
      conversation = await this.conversationRepo.findOneBy({ _id: new ObjectId(data.conversationId) });
    } else if (receiverObjId && !creatorId.equals(receiverObjId)) {
      conversation = await this.conversationRepo.findOne({
        where: { participants: { $all: [creatorId, receiverObjId] } } as any,
        order: { updatedAt: "DESC" }
      });
      if (!conversation) {
        conversation = new Conversation();
        conversation.participants = [creatorId, receiverObjId];
        conversation.status = "PENDING";
        conversation.unreadCounts = {};
        conversation = await this.conversationRepo.save(conversation);
      }
    }

    if (conversation) {
      if (conversation.isDeleted || conversation.status === "DELETED" || conversation.deletedBy) {
        conversation.status = "PENDING";
        conversation.isDeleted = false;
        delete conversation.deletedBy;
        await this.conversationRepo.save(conversation);
      }

      const targetReceiverId = conversation.participants.find(p => !p.equals(creatorId)) || receiverObjId;
      const messageText = data.title;

      const newMessage = new Message();
      newMessage.conversationId = conversation._id;
      newMessage.senderId = creatorId;
      newMessage.content = messageText;
      newMessage.type = MessageType.REMINDER;
      newMessage.reminderId = savedReminder._id;
      newMessage.businessActionId = savedReminder._id;
      newMessage.isRead = false;

      let isReceiverActive = false;
      if (targetReceiverId) {
        isReceiverActive = isUserInConversation(targetReceiverId.toString(), conversation._id.toString());
        if (isReceiverActive) {
          newMessage.isRead = true;
        }
      }

      const savedMessage = await this.messageRepo.save(newMessage);

      if (targetReceiverId) {
        // const receiverMember = await this.memberRepo.findOneBy({ _id: targetReceiverId, isDeleted: false });
        // if (!isReceiverActive && receiverMember?.fcmToken) {
        //   await insertPushNotification({
        //     token: receiverMember.fcmToken,
        //     subject: `New Reminder: ${data.title}`,
        //     content: messageText,
        //     moduleName: NotificationModule.MESSAGE_REQUEST,
        //     moduleId: conversation._id.toString(),
        //     receiverId: targetReceiverId.toString(),
        //     senderId: creatorId.toString()
        //   });
        // }

        const unreadCounts = conversation.unreadCounts || {};
        if (isReceiverActive) {
          unreadCounts[targetReceiverId.toString()] = 0;
        } else {
          unreadCounts[targetReceiverId.toString()] = (unreadCounts[targetReceiverId.toString()] || 0) + 1;
        }
        conversation.unreadCounts = { ...unreadCounts };
      }

      conversation.lastMessage = savedMessage.content;
      conversation.lastMessageTime = new Date();
      conversation.lastMessageSenderId = creatorId;
      await this.conversationRepo.save(conversation);

      if (targetReceiverId) {
        const io = getIO();
        io.to(targetReceiverId.toString()).emit("new_message", {
          ...savedMessage,
          reminder: savedReminder
        });

        const senderMember = await this.memberRepo.findOneBy({ _id: creatorId });
        const unreadCount = conversation.unreadCounts?.[targetReceiverId.toString()] || 0;

        io.to(targetReceiverId.toString()).emit("conversation_updated", {
          ...conversation,
          lastMessage: savedMessage.content,
          lastMessageTime: savedMessage.createdAt,
          lastMessageSenderId: savedMessage.senderId,
          otherUser: senderMember ? {
            _id: senderMember._id,
            fullName: senderMember.fullName,
            profilePhoto: senderMember.profilePhoto,
            isOnline: senderMember.isOnline || false,
            lastSeen: senderMember.lastSeen || null
          } : null,
          unreadCount
        });
      }
    }

    return savedReminder;
  }

  async updateReminder(id: string, data: UpdateReminderDto, userId: string): Promise<Reminder> {
    const reminderId = this.validateObjectId(id, "id");
    const updaterId = this.validateObjectId(userId, "userId");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    if (data.title !== undefined) reminder.title = data.title;
    if (data.description !== undefined) reminder.description = data.description;

    if (data.reminderDate !== undefined) {
      reminder.reminderDate = new Date(data.reminderDate);
      if (isNaN(reminder.reminderDate.getTime())) {
        throw new BadRequestError("Invalid reminderDate format.");
      }
      reminder.nextReminderDate = new Date(reminder.reminderDate);
    }

    if (data.reminderTime !== undefined) reminder.reminderTime = data.reminderTime;
    if (data.repeatType !== undefined) reminder.repeatType = data.repeatType;
    if (data.repeatInterval !== undefined) reminder.repeatInterval = data.repeatInterval;
    if (data.status !== undefined) reminder.status = data.status;
    if (data.isActive !== undefined) reminder.isActive = data.isActive;

    if (data.notifyBy !== undefined) reminder.notifyBy = data.notifyBy;
    reminder.recipients = [updaterId];
    reminder.updatedBy = updaterId;

    return await this.reminderRepo.save(reminder);
  }

  async deleteReminder(id: string, userId: string): Promise<void> {
    const reminderId = this.validateObjectId(id, "id");
    const updaterId = this.validateObjectId(userId, "userId");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    reminder.isDeleted = true;
    reminder.updatedBy = updaterId;
    await this.reminderRepo.save(reminder);
  }

  async getReminder(id: string): Promise<Reminder> {
    const reminderId = this.validateObjectId(id, "id");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    return reminder;
  }

  async getReminderList(filters: ReminderListDto, userId?: string): Promise<{ total: number; data: Reminder[] }> {
    const page = Number(filters.page) || 0;
    const limit = Number(filters.limit) || 10;

    const conditions: any[] = [{ isDeleted: false }];

    if (userId && ObjectId.isValid(userId)) {
      const userObjId = new ObjectId(userId);
      conditions.push({
        $or: [
          { createdBy: userObjId },
          { recipients: userObjId },
          { recipients: { $in: [userObjId] } }
        ]
      });
    }

    if (filters.module) {
      conditions.push({ module: filters.module.toUpperCase() });
    }

    if (filters.status) {
      conditions.push({ status: filters.status });
    }

    if (filters.isActive !== undefined) {
      conditions.push({ isActive: filters.isActive });
    }

    if (filters.fromDate || filters.toDate) {
      const dateCond: any = {};
      if (filters.fromDate) {
        const from = new Date(filters.fromDate);
        if (!isNaN(from.getTime())) {
          dateCond.$gte = from;
        }
      }
      if (filters.toDate) {
        const to = new Date(filters.toDate);
        if (!isNaN(to.getTime())) {
          dateCond.$lte = to;
        }
      }
      if (Object.keys(dateCond).length > 0) {
        conditions.push({ reminderDate: dateCond });
      }
    }

    if (filters.search) {
      conditions.push({
        $or: [
          { title: { $regex: filters.search, $options: "i" } },
          { description: { $regex: filters.search, $options: "i" } }
        ]
      });
    }

    const where = conditions.length === 1 ? conditions[0] : { $and: conditions };

    const [reminders, total] = await this.reminderRepo.findAndCount({
      where: where as any,
      skip: page * limit,
      take: limit,
      order: { createdAt: "DESC" }
    });

    return { total, data: reminders };
  }

  async toggleReminder(id: string, userId: string): Promise<Reminder> {
    const reminderId = this.validateObjectId(id, "id");
    const updaterId = this.validateObjectId(userId, "userId");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    reminder.isActive = !reminder.isActive;
    reminder.updatedBy = updaterId;

    return await this.reminderRepo.save(reminder);
  }

  async sendReminderNow(id: string): Promise<void> {
    const reminderId = this.validateObjectId(id, "id");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    console.log(`[ReminderTrigger] Sending notification manually for reminder: "${reminder.title}"`);
    console.log(`Recipients: ${reminder.recipients.map(r => r.toString()).join(", ")}`);
    console.log(`Channels: ${reminder.notifyBy.join(", ")}`);

    // Simulate sending notification
    reminder.lastTriggeredAt = new Date();
    await this.reminderRepo.save(reminder);
  }
}
