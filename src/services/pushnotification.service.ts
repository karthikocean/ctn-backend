import { ObjectId } from "mongodb";
import { NotificationModule } from "../entity/PushNotifications";
import { AppDataSource } from "../data-source";
import { InsertPushNotificationDto } from "../dto/mobile/InsertPushNotification.dto";
import { Member, MemberStatus } from "../entity/Member";
import { Connection, ConnectionStatus } from "../entity/Connection";
import { PostModel, PostType, RequirementVisibility } from "../entity/Post";
import { AdminUser } from "../entity/AdminUser";
import { getIO } from "../utils/socket";
import { FcmService } from "./fcm.service";
import { NotificationProducerService } from "./notificationProducer.service";

/**
 * Send push notification to a single FCM token (FCM HTTP v1)
 */
export async function sendPushNotification(token: string, title: string, input: any): Promise<boolean> {
  if (!token || typeof token !== "string") {
    console.error("Invalid or empty token.");
    return false;
  }
  try {
    return await FcmService.sendToToken(token, {
      title,
      body: input?.content ?? "",
      data: {
        moduleName: String(input?.moduleName ?? ""),
        moduleId: String(input?.moduleId ?? ""),
      },
    });
  } catch (error: any) {
    console.error("[sendPushNotification] Error:", error.message);
    return false;
  }
}

/**
 * Inserts a single push notification and dispatches FCM & socket update asynchronously via BullMQ.
 */
export async function insertPushNotification(dto: InsertPushNotificationDto): Promise<boolean> {
  try {
    await NotificationProducerService.enqueuePersonalNotification({
      receiverId: dto.receiverId,
      subject: dto.subject,
      content: dto.content,
      moduleName: dto.moduleName as any,
      moduleId: dto.moduleId,
      senderId: dto.senderId,
      fcmToken: dto.token,
    });
    return true;
  } catch (error: any) {
    console.error("Error queueing personal notification:", error.message);
    return false;
  }
}

/**
 * Broadcasts a notification to ALL active members using BullMQ orchestrator & MongoDB cursor streaming.
 * API returns immediately with success while background workers process 1,000,000 members in batches.
 */
export async function notifyAllActiveMembers(dto: {
  subject: string;
  content: string;
  moduleName: NotificationModule;
  moduleId?: string;
  senderId?: string;
}) {
  try {
    const result = await NotificationProducerService.enqueueBroadcastNotification({
      subject: dto.subject,
      content: dto.content,
      moduleName: dto.moduleName,
      moduleId: dto.moduleId,
      senderId: dto.senderId,
      useTopic: false, // Set to true if FCM Topic broadcast is enabled
    });

    console.log(`✅ [notifyAllActiveMembers] Queued broadcast job ${result.broadcastId} for 1,000,000+ members.`);
    return { success: true, broadcastId: result.broadcastId };
  } catch (error: any) {
    console.error("Failed to notify all active members:", error.message);
    throw error;
  }
}

/**
 * Sends post-creation push notifications to targeted post audience using BullMQ batch producer.
 */
export async function notifyPostAudience(dto: {
  post: PostModel;
  senderId: string;
  subject: string;
  content: string;
}) {
  try {
    const { post, senderId, subject, content } = dto;
    const senderObjectId = new ObjectId(senderId);

    let mappedModule = NotificationModule.GENERAL;
    if (post.type === PostType.PROMOTION) mappedModule = NotificationModule.PROMOTION;
    else if (post.type === PostType.ASK) mappedModule = NotificationModule.ASK;
    else if (post.type === PostType.GIVE) mappedModule = NotificationModule.GIVE;
    else if (post.type === PostType.REQUIREMENT) mappedModule = NotificationModule.REQUIREMENT;

    const memberRepo = AppDataSource.getMongoRepository(Member);
    const connectionRepo = AppDataSource.getMongoRepository(Connection);

    const isMutualFriend = post.requirementVisibility === RequirementVisibility.MUTUAL_FRIEND || post.type === PostType.GIVE;
    const hasCategoryFilter = (post.categoryIds && post.categoryIds.length > 0) ||
      (post.subCategoryIds && post.subCategoryIds.length > 0);

    const dbOnly = !isMutualFriend && !hasCategoryFilter;
    let targetMembers: Member[] = [];

    if (!dbOnly) {
      let mutualIds: Set<string> | null = null;
      if (isMutualFriend) {
        const following = await connectionRepo.find({
          where: { senderId: senderObjectId, status: ConnectionStatus.ACCEPTED } as any
        });
        const followingIds = new Set(following.map(c => c.receiverId.toString()));
        const followers = await connectionRepo.find({
          where: { receiverId: senderObjectId, status: ConnectionStatus.ACCEPTED } as any
        });
        const followerIds = new Set(followers.map(c => c.senderId.toString()));
        mutualIds = new Set([...followingIds].filter(id => followerIds.has(id)));
      }

      if (hasCategoryFilter) {
        const categoryConditions: any[] = [];
        if (post.categoryIds && post.categoryIds.length > 0) {
          categoryConditions.push({ businessCategory: { $in: post.categoryIds } });
        }
        if (post.subCategoryIds && post.subCategoryIds.length > 0) {
          categoryConditions.push({ subCategory: { $in: post.subCategoryIds } });
        }
        const categoryWhere: any = {
          $or: categoryConditions,
          isDeleted: false,
          status: MemberStatus.ACTIVE,
          _id: { $ne: senderObjectId }
        };
        if (post.regionIds && post.regionIds.length > 0) {
          categoryWhere.businessRegion = { $in: post.regionIds };
        }
        targetMembers = await memberRepo.find({ where: categoryWhere });
      }

      if (isMutualFriend && hasCategoryFilter && mutualIds) {
        targetMembers = targetMembers.filter(m => mutualIds!.has(m._id.toString()));
      } else if (isMutualFriend && mutualIds) {
        const mutualObjectIds = [...mutualIds].map(id => new ObjectId(id));
        if (mutualObjectIds.length > 0) {
          targetMembers = await memberRepo.find({
            where: { _id: { $in: mutualObjectIds }, isDeleted: false, status: MemberStatus.ACTIVE } as any
          });
        }
      }
    } else {
      // Bulk enqueue broadcast for DB-only active members
      await NotificationProducerService.enqueueBroadcastNotification({
        subject,
        content,
        moduleName: mappedModule,
        moduleId: post._id?.toString(),
        senderId,
      });
      return;
    }

    // Ensure sender is excluded from target members so creator never receives notification for their own post
    targetMembers = targetMembers.filter(m => m._id.toString() !== senderObjectId.toString());

    // Queue target personal notifications via BullMQ batch producer
    const personalDtos = targetMembers.map((member) => ({
      receiverId: member._id.toString(),
      subject,
      content,
      moduleName: mappedModule as any,
      moduleId: post._id?.toString(),
      senderId,
      fcmToken: member.fcmToken,
    }));

    await NotificationProducerService.enqueuePersonalBatch(personalDtos);
    console.log(`[notifyPostAudience] Queued ${personalDtos.length} notifications for post ${post._id}`);
  } catch (error: any) {
    console.error("[notifyPostAudience] Failed:", error.message);
  }
}

/**
 * Sends push notifications for published announcements to specific regions or ALL active members.
 */
export async function notifyAnnouncementAudience(dto: {
  announcementId: string;
  title: string;
  content: string;
  regionId?: string;
  regionIds?: string[];
  senderId?: string;
}) {
  try {
    // If no region filter, use zero-RAM Mongo cursor broadcast
    if ((!dto.regionIds || dto.regionIds.length === 0) && !dto.regionId) {
      await NotificationProducerService.enqueueBroadcastNotification({
        subject: dto.title || "New Announcement",
        content: dto.content,
        moduleName: NotificationModule.EVENT,
        moduleId: dto.announcementId,
        senderId: dto.senderId,
      });
      return;
    }

    const memberRepo = AppDataSource.getMongoRepository(Member);
    const whereCondition: any = {
      status: MemberStatus.ACTIVE,
      isDeleted: false,
    };

    if (dto.regionIds && dto.regionIds.length > 0) {
      const regObjectIds = dto.regionIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
      whereCondition.$or = [
        { businessRegion: { $in: regObjectIds } },
        { businessRegion: { $in: dto.regionIds } },
      ];
    } else if (dto.regionId && ObjectId.isValid(dto.regionId)) {
      const regId = new ObjectId(dto.regionId);
      whereCondition.$or = [
        { businessRegion: regId },
        { businessRegion: dto.regionId },
      ];
    }

    const activeMembers = await memberRepo.find({ where: whereCondition, select: { _id: true, fcmToken: true } as any });
    if (!activeMembers || activeMembers.length === 0) return;

    const personalDtos = activeMembers.map((member) => ({
      receiverId: member._id.toString(),
      subject: dto.title || "New Announcement",
      content: dto.content,
      moduleName: NotificationModule.EVENT,
      moduleId: dto.announcementId,
      senderId: dto.senderId,
      fcmToken: member.fcmToken,
    }));

    await NotificationProducerService.enqueuePersonalBatch(personalDtos);
    console.log(`✅ [notifyAnnouncementAudience] Queued ${personalDtos.length} notifications for announcement ${dto.announcementId}`);
  } catch (error: any) {
    console.error("Failed to notify announcement audience:", error.message);
  }
}

/**
 * Sends push notification & socket notification to active admins on new suggestions.
 */
export async function notifyAdminOnSuggestion(dto: {
  suggestionId: string | ObjectId;
  title: string;
  description: string;
  memberId: string | ObjectId;
}) {
  try {
    const adminRepo = AppDataSource.getMongoRepository(AdminUser);
    const activeAdmins = await adminRepo.find({
      where: { isActive: true, isDeleted: false } as any,
    });

    if (activeAdmins.length === 0) return;

    const personalDtos = activeAdmins.map((admin) => ({
      receiverId: admin.id.toString(),
      subject: `New Suggestion: ${dto.title}`,
      content: dto.description || "",
      moduleName: NotificationModule.SUGGESTION,
      moduleId: dto.suggestionId.toString(),
      senderId: dto.memberId.toString(),
    }));

    await NotificationProducerService.enqueuePersonalBatch(personalDtos);

    // Live Socket Notification to admin room
    try {
      const io = getIO();
      if (io) {
        const payload = {
          suggestionId: dto.suggestionId.toString(),
          title: dto.title,
          description: dto.description,
          memberId: dto.memberId.toString(),
          createdAt: new Date(),
        };
        io.to("admin_room").emit("new_suggestion", payload);
      }
    } catch (socketErr: any) {
      console.error("[notifyAdminOnSuggestion] Socket emission error:", socketErr.message);
    }
  } catch (error: any) {
    console.error("Failed to notify admin on suggestion:", error.message);
  }
}
