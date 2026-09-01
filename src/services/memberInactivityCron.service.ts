import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { NotificationModule, PushNotification } from "../entity/PushNotifications";
import { sendPushNotification } from "./pushnotification.service";

export class MemberInactivityCronService {
  private static memberRepo = AppDataSource.getMongoRepository(Member);
  private static notificationRepo = AppDataSource.getMongoRepository(PushNotification);

  /**
   * Initializes the Member Inactivity cron jobs:
   * 1. 12:01 AM Asia/Kolkata: Deactivate members inactive for 15+ days.
   * 2. 09:00 AM Asia/Kolkata: Send daily reminder push notification to members inactive for 5+ days.
   */
  static init() {
    console.log("⏰ Initializing Member Inactivity Cron Jobs...");

    // 1. 12:01 AM - Deactivate members inactive for 15+ days
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Member Inactivity Deactivation Cron (12:01 AM)...");
        await this.deactivateInactiveMembers();
      } catch (error: any) {
        console.error("❌ Member Inactivity Deactivation Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });

    // 2. 09:00 AM - Send daily reminder push notification to members inactive for 5+ days
    cron.schedule("0 9 * * *", async () => {
      try {
        console.log("🕒 Running Member Inactivity Reminder Notification Cron (09:00 AM)...");
        await this.sendInactivityReminders();
      } catch (error: any) {
        console.error("❌ Member Inactivity Reminder Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Deactivates members whose last login was more than 15 days ago
   * (or who haven't logged in since registration > 15 days ago).
   */
  static async deactivateInactiveMembers() {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const result = await this.memberRepo.updateMany(
      {
        status: MemberStatus.ACTIVE,
        isDeleted: false,
        $or: [
          { lastLoggedIn: { $lt: fifteenDaysAgo } },
          { lastLoggedIn: null, createdAt: { $lt: fifteenDaysAgo } },
          { lastLoggedIn: { $exists: false }, createdAt: { $lt: fifteenDaysAgo } }
        ]
      } as any,
      {
        $set: {
          status: MemberStatus.INACTIVE
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `✅ Member Inactivity: ${result.modifiedCount} member(s) marked as inactive due to 15+ days of inactivity.`
      );
    } else {
      console.log("⏭️  Member Inactivity: No inactive members found.");
    }

    return result;
  }

  /**
   * Sends a daily reminder push notification at 9:00 AM to active members
   * who have not logged in for 5 or more consecutive days.
   */
  static async sendInactivityReminders() {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const inactiveMembers = await this.memberRepo.find({
      where: {
        status: MemberStatus.ACTIVE,
        isDeleted: false,
        $or: [
          { lastLoggedIn: { $lte: fiveDaysAgo } },
          { lastLoggedIn: null, createdAt: { $lte: fiveDaysAgo } },
          { lastLoggedIn: { $exists: false }, createdAt: { $lte: fiveDaysAgo } }
        ]
      } as any
    });

    console.log(
      `[MemberInactivityReminder] Found ${inactiveMembers.length} active member(s) not logged in for 5+ days.`
    );

    if (inactiveMembers.length === 0) {
      console.log("[MemberInactivityReminder] No members to notify today.");
      return;
    }

    const subject = "We Miss You! Stay Connected";

    // 1. Bulk insert in-app notification records
    const notifications = inactiveMembers.map((member) => ({
      sub: subject,
      msg: `Hi ${member.fullName || "Member"}, you haven't checked in for 5 days. Open Trusted Network to catch up with your network, explore updates, and discover new opportunities!`,
      moduleName: NotificationModule.REMINDER,
      receiverId: member._id,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    await this.notificationRepo.insertMany(notifications as any);
    console.log(
      `[MemberInactivityReminder] Bulk inserted ${notifications.length} in-app notification records.`
    );

    // 2. Dispatch FCM push notifications to members with active tokens
    const membersWithToken = inactiveMembers.filter((m) => m.fcmToken);
    console.log(
      `[MemberInactivityReminder] Dispatching push notifications to ${membersWithToken.length} members with FCM tokens...`
    );

    const batchSize = 100;
    for (let i = 0; i < membersWithToken.length; i += batchSize) {
      const batch = membersWithToken.slice(i, i + batchSize);
      await Promise.all(
        batch.map((member) => {
          const content = `Hi ${member.fullName || "Member"}, you haven't checked in for 5 days. Open Trusted Network to catch up with your network, explore updates, and discover new opportunities!`;
          return sendPushNotification(member.fcmToken!, subject, {
            content,
            moduleName: NotificationModule.REMINDER
          }).catch((err) =>
            console.error(
              `[MemberInactivityReminder] FCM failed for member ${member._id}:`,
              err.message
            )
          );
        })
      );
    }

    console.log("[MemberInactivityReminder] Push notification dispatch completed.");
  }
}
