import { JWT } from "google-auth-library";
import axios from "axios";
import path from "path";
import * as fs from "fs";
import { ObjectId } from "mongodb";
import { NotificationModule, PushNotification } from "../entity/PushNotifications";
import { AppDataSource } from "../data-source";
import { InsertPushNotificationDto } from "../dto/mobile/InsertPushNotification.dto";
import { Member, MemberStatus } from "../entity/Member";
import { Connection, ConnectionStatus } from "../entity/Connection";
import { PostModel, PostType, RequirementVisibility } from "../entity/Post";
import { AdminUser } from "../entity/AdminUser";
import { emitUnreadCount, getIO } from "../utils/socket";

const FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects/tn-business-forum/messages:send";
const serviceAccountPath = path.join(__dirname, "../views", "google-firebase.json");

// Load service account explicitly to ensure it's valid
let serviceAccount: any;
try {
  serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  console.log("✅ FCM Service Account loaded:", serviceAccount.client_email);
} catch (error) {
  console.error("❌ Failed to load FCM service account:", error);
}

// Initialize JWT client for Firebase
const client = new JWT({
  email: serviceAccount?.client_email,
  key: serviceAccount?.private_key,
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

export async function sendPushNotification(token: string, title: string, input: any) {
  if (!token || typeof token !== "string") {
    console.error("Invalid or empty token.");
    return false;
  }

  try {
    const { token: accessToken } = await client.getAccessToken();

    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    console.log(`Sending notification to token: ${token}`, title, input);

    const message = {
      message: {
        token,
        notification: {
          title,
          body: input.content ?? "",
        },
        data: {
          moduleName: input.moduleName ?? "",
          moduleId: input.moduleId ?? ""
        },
      },
    };

    const response = await axios.post(FCM_ENDPOINT, message, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`Notification sent successfully to token [${token}]:`, response.data);

    return response.data;

  } catch (error: any) {
    console.error("Error sending notification:", error?.response?.data ?? error.message);
    return false;
  }
}
export async function insertPushNotification(
  dto: InsertPushNotificationDto
) {
  try {
    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);

    const {
      token,
      subject,
      moduleId,
      moduleName,
      content,
      receiverId,
      senderId,
    } = dto;

    const notification = new PushNotification();

    notification.sub = subject ?? "";
    notification.msg = content ?? "";
    notification.moduleName = moduleName as NotificationModule.REMINDER;

    if (moduleId)
      notification.moduleId = new ObjectId(moduleId);

    notification.receiverId = new ObjectId(receiverId);

    if (senderId)
      notification.senderId = new ObjectId(senderId);
    notification.isDeleted = false;
    notification.isRead = false;
    const notificationData = await notificationRepo.save(notification);
    if (notificationData) {
      const contentObj = {
        content,
        moduleName,
        moduleId,
      };

      await sendPushNotification(
        token,
        subject,
        contentObj
      );

      // Emit live unread count to receiver via socket
      emitUnreadCount(receiverId).catch(() => { });

      return true;
    }

    return false;

  } catch (error: any) {
    console.error(
      "Error sending notification:",
      error?.response?.data ?? error.message
    );

    return false;
  }
}

export async function notifyAllActiveMembers(dto: {
  subject: string;
  content: string;
  moduleName: NotificationModule;
  moduleId?: string;
  senderId?: string;
}) {
  try {
    const memberRepo = AppDataSource.getMongoRepository(Member);
    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);
    const activeMembers = await memberRepo.find({
      where: {
        status: MemberStatus.ACTIVE,
        isDeleted: false
      } as any
    });

    const notifications = activeMembers.map(member => ({
      sub: dto.subject,
      msg: dto.content,
      moduleName: dto.moduleName,
      moduleId: dto.moduleId ? new ObjectId(dto.moduleId) : undefined,
      receiverId: member._id,
      senderId: dto.senderId ? new ObjectId(dto.senderId) : undefined,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    if (notifications.length > 0) {
      await notificationRepo.insertMany(notifications);

      // Emit live unread count to each receiver via socket
      activeMembers.forEach(member => {
        emitUnreadCount(member._id.toString()).catch(() => { });
      });
    }

    // Send push notification to all active members with FCM token
    const membersWithToken = activeMembers.filter(m => m.fcmToken);
    const batchSize = 100;
    for (let i = 0; i < membersWithToken.length; i += batchSize) {
      const batch = membersWithToken.slice(i, i + batchSize);
      await Promise.all(
        batch.map(member =>
          sendPushNotification(member.fcmToken!, dto.subject, {
            content: dto.content,
            moduleName: dto.moduleName,
            moduleId: dto.moduleId
          }).catch(err => console.error("[notifyAllActiveMembers] FCM error:", err))
        )
      );
    }
  } catch (error) {
    console.error("Failed to notify all active members:", error);
  }
}

/**
 * Sends post-creation push notifications to the relevant audience.
 *
 * - MUTUAL-FRIEND visibility  → notify only mutual friends of the poster
 * - categoryIds / subCategoryIds present → notify members whose businessCategory / subCategory matches
 * - Both conditions → intersection of the above two sets
 * - None of the above (OVERALL / REGION, no category) → insert DB record only, NO FCM dispatch
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
    if (post.type === PostType.PROMOTION) {
      mappedModule = NotificationModule.PROMOTION;
    } else if (post.type === PostType.ASK) {
      mappedModule = NotificationModule.ASK;
    } else if (post.type === PostType.GIVE) {
      mappedModule = NotificationModule.GIVE;
    } else if (post.type === PostType.REQUIREMENT) {
      mappedModule = NotificationModule.REQUIREMENT;
    }

    const memberRepo = AppDataSource.getMongoRepository(Member);
    const connectionRepo = AppDataSource.getMongoRepository(Connection);
    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);

    const isMutualFriend = post.requirementVisibility === RequirementVisibility.MUTUAL_FRIEND;
    const hasCategoryFilter = (post.categoryIds && post.categoryIds.length > 0) ||
      (post.subCategoryIds && post.subCategoryIds.length > 0);

    // No targeted notification condition — insert DB-only records for active members, skip FCM
    const dbOnly = !isMutualFriend && !hasCategoryFilter;

    let targetMembers: Member[] = [];

    if (!dbOnly) {
      let mutualIds: Set<string> | null = null;

      // --- Mutual friends resolution ---
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

      // --- Category-matched members resolution ---
      let categoryMemberIds: Set<string> | null = null;
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
        const categoryMembers = await memberRepo.find({
          where: categoryWhere
        });
        categoryMemberIds = new Set(categoryMembers.map(m => m._id.toString()));
        targetMembers.push(...categoryMembers);
      }

      // --- Resolve final target list (apply intersection if both conditions apply) ---
      if (isMutualFriend && hasCategoryFilter && mutualIds && categoryMemberIds) {
        // Intersection: member must be a mutual friend AND match the category filter
        targetMembers = targetMembers.filter(m => mutualIds!.has(m._id.toString()));
      } else if (isMutualFriend && mutualIds) {
        // Mutual friends only — fetch the actual member docs
        const mutualObjectIds = [...mutualIds].map(id => new ObjectId(id));
        if (mutualObjectIds.length > 0) {
          const mutualWhere: any = {
            _id: { $in: mutualObjectIds },
            isDeleted: false,
            status: MemberStatus.ACTIVE
          };
          if (post.regionIds && post.regionIds.length > 0) {
            mutualWhere.businessRegion = { $in: post.regionIds };
          }
          targetMembers = await memberRepo.find({
            where: mutualWhere
          });
        }
      }
    } else {
      // DB-only: fetch all active members to create inbox records
      targetMembers = await memberRepo.find({
        where: { isDeleted: false, status: MemberStatus.ACTIVE, _id: { $ne: senderObjectId } } as any
      });
    }

    console.log(`[notifyPostAudience] Notifying ${targetMembers.length} members (dbOnly=${dbOnly}) for post ${post._id}`);

    const notifications = targetMembers.map(member => ({
      sub: subject,
      msg: content,
      moduleName: mappedModule,
      moduleId: post._id,
      receiverId: member._id,
      senderId: senderObjectId,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    if (notifications.length > 0) {
      await notificationRepo.insertMany(notifications);

      // Emit live unread count to each receiver via socket
      targetMembers.forEach(member => {
        emitUnreadCount(member._id.toString()).catch(() => { });
      });
    }

    // FCM dispatch only for targeted audiences (not DB-only)
    if (!dbOnly) {
      const membersWithToken = targetMembers.filter(m => m.fcmToken);
      const batchSize = 100;
      for (let i = 0; i < membersWithToken.length; i += batchSize) {
        const batch = membersWithToken.slice(i, i + batchSize);
        await Promise.all(
          batch.map(member =>
            sendPushNotification(member.fcmToken!, subject, {
              content,
              moduleName: mappedModule,
              moduleId: post._id?.toString()
            }).catch(err => console.error("[notifyPostAudience] FCM error:", err))
          )
        );
      }
    }
  } catch (error) {
    console.error("[notifyPostAudience] Failed:", error);
  }
}

/**
 * Sends push notifications for published announcements.
 * - If regionId is provided -> notifies active members in that region (matching member.businessRegion)
 * - If no regionId -> notifies ALL active members
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
    const memberRepo = AppDataSource.getMongoRepository(Member);
    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);

    const whereCondition: any = {
      status: MemberStatus.ACTIVE,
      isDeleted: false
    };

    if (dto.regionIds && dto.regionIds.length > 0) {
      const regObjectIds = dto.regionIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
      const rawStringIds = dto.regionIds.filter(id => typeof id === "string");
      whereCondition.$or = [
        { businessRegion: { $in: regObjectIds } },
        { businessRegion: { $in: dto.regionIds } },
        { businessRegion: { $in: rawStringIds } }
      ];
    } else if (dto.regionId && ObjectId.isValid(dto.regionId)) {
      const regId = new ObjectId(dto.regionId);
      whereCondition.$or = [
        { businessRegion: regId },
        { businessRegion: dto.regionId }
      ];
    }

    const activeMembers = await memberRepo.find({
      where: whereCondition
    });
    console.log(activeMembers.length, "activeMembers");
    if (!activeMembers || activeMembers.length === 0) {
      console.log("[notifyAnnouncementAudience] No matching active members found.");
      return;
    }

    const notifications = activeMembers.map(member => ({
      sub: dto.title || "New Announcement",
      msg: dto.content || "",
      moduleName: NotificationModule.EVENT,
      moduleId: new ObjectId(dto.announcementId),
      receiverId: member._id,
      senderId: dto.senderId && ObjectId.isValid(dto.senderId) ? new ObjectId(dto.senderId) : undefined,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    await notificationRepo.insertMany(notifications);

    // Emit live unread count via socket
    activeMembers.forEach(member => {
      emitUnreadCount(member._id.toString()).catch(() => { });
    });

    // Send FCM push notifications to members with token
    const membersWithToken = activeMembers.filter(m => m.fcmToken);
    const batchSize = 100;
    for (let i = 0; i < membersWithToken.length; i += batchSize) {
      const batch = membersWithToken.slice(i, i + batchSize);
      await Promise.all(
        batch.map(member =>
          sendPushNotification(member.fcmToken!, dto.title || "New Announcement", {
            content: dto.content,
            moduleName: NotificationModule.EVENT,
            moduleId: dto.announcementId
          }).catch(err => console.error("[notifyAnnouncementAudience] FCM error:", err))
        )
      );
    }
    console.log(`✅ [notifyAnnouncementAudience] Notified ${activeMembers.length} members for announcement ${dto.announcementId}`);
  } catch (error) {
    console.error("Failed to notify announcement audience:", error);
  }
}

/**
 * Sends push notification & socket notification to all active admins when a new suggestion is created.
 */
export async function notifyAdminOnSuggestion(dto: {
  suggestionId: string | ObjectId;
  title: string;
  description: string;
  memberId: string | ObjectId;
}) {
  try {
    const adminRepo = AppDataSource.getMongoRepository(AdminUser);
    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);

    const activeAdmins = await adminRepo.find({
      where: { isActive: true, isDeleted: false } as any
    });

    const memberOid = new ObjectId(dto.memberId);
    const suggestionOid = new ObjectId(dto.suggestionId);

    if (activeAdmins.length > 0) {
      const notifications = activeAdmins.map(admin => ({
        sub: `New Suggestion: ${dto.title}`,
        msg: dto.description || "",
        moduleName: NotificationModule.SUGGESTION,
        moduleId: suggestionOid,
        receiverId: admin.id,
        senderId: memberOid,
        isRead: false,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      await notificationRepo.insertMany(notifications);
    }

    // Live Socket Notification to admin room & admin sockets
    try {
      const io = getIO();
      const payload = {
        suggestionId: dto.suggestionId.toString(),
        title: dto.title,
        description: dto.description,
        memberId: dto.memberId.toString(),
        createdAt: new Date()
      };

      io.to("admin_room").emit("new_suggestion", payload);
      activeAdmins.forEach(admin => {
        if (admin.id) {
          const adminIdStr = admin.id.toString();
          io.to(adminIdStr).emit("new_suggestion", payload);
          emitUnreadCount(adminIdStr).catch(() => { });
        }
      });
      console.log(`✅ [notifyAdminOnSuggestion] Push notification & socket event sent for suggestion ${dto.suggestionId}`);
    } catch (socketErr) {
      console.error("[notifyAdminOnSuggestion] Socket emission error:", socketErr);
    }
  } catch (error) {
    console.error("Failed to notify admin on suggestion:", error);
  }
}
