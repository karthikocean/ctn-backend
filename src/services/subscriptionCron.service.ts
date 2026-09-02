import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { MemberSubscription } from "../entity/MemberSubscription";
import { insertPushNotification } from "./pushnotification.service";
import { MailService } from "./mail.service";
import cron from "node-cron";
import { NotificationModule } from "../entity/PushNotifications";
import { ObjectId } from "mongodb";

export class SubscriptionCronService {
  private static get memberRepo() {
    return AppDataSource.getMongoRepository(Member);
  }
  private static get subRepo() {
    return AppDataSource.getMongoRepository(MemberSubscription);
  }

  /**
   * Initializes the cron jobs for subscription expiration & trial plan notifications
   */
  static init() {
    console.log("⏰ Initializing Subscription Cron Jobs...");

    // 1. Run daily at 12:01 AM for expiration processing: "1 0 * * *"
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Subscription Expiration Cron...");
        await this.runDailySubscriptionJob();
      } catch (error: any) {
        console.error("❌ Subscription Expiration Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });

    // 2. Run daily at 10:00 AM for Trial plan remaining days notification: "0 10 * * *"
    cron.schedule("0 10 * * *", async () => {
      try {
        console.log("🕒 Running Trial Plan Daily Remaining Days Notification Cron (10:00 AM)...");
        await this.runTrialPlanDailyNotificationJob();
      } catch (error: any) {
        console.error("❌ Trial Plan Daily Notification Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Helper: Bulk fetch members by an array of member IDs (O(1) database query)
   */
  private static async getMembersMap(memberIds: (ObjectId | string)[]): Promise<Map<string, Member>> {
    const validOids = memberIds
      .filter((id): id is ObjectId | string => Boolean(id) && ObjectId.isValid(id.toString()))
      .map(id => (typeof id === "string" ? new ObjectId(id) : id));

    if (validOids.length === 0) return new Map();

    const members = await this.memberRepo.find({
      where: { _id: { $in: validOids }, isDeleted: false } as any
    });

    return new Map(members.map(m => [m._id.toString(), m]));
  }

  /**
   * Main job execution logic (can be triggered manually as well)
   */
  static async runDailySubscriptionJob() {
    const now = new Date();

    // ==========================================
    // 1. PROCESS EXPIRED SUBSCRIPTIONS
    // ==========================================
    const expiredSubscriptions = await this.subRepo.find({
      where: {
        endDate: { $lt: now },
        status: "ACTIVE",
        isDeleted: false
      } as any
    });

    console.log(`[Cron] Found ${expiredSubscriptions.length} expired subscriptions.`);

    if (expiredSubscriptions.length > 0) {
      const expiredSubIds = expiredSubscriptions.map(s => s._id);
      const expiredMemberIds = expiredSubscriptions.map(s => s.memberId);

      // Bulk fetch all relevant members in 1 single query (eliminates N+1)
      const memberMap = await this.getMembersMap(expiredMemberIds);

      // Bulk update expired subscriptions to EXPIRED
      await this.subRepo.updateMany(
        { _id: { $in: expiredSubIds } } as any,
        { $set: { status: "EXPIRED" } } as any
      );

      // Bulk downgrade members to Guest access
      await this.memberRepo.updateMany(
        { _id: { $in: expiredMemberIds } } as any,
        { $set: { subscriptionId: null, planId: null } } as any
      );

      // Send notifications
      for (const sub of expiredSubscriptions) {
        try {
          const member = memberMap.get(sub.memberId.toString());
          if (!member) continue;

          const messageText = `Your ${sub.type} subscription expired today and has been downgraded to Guest Access. Upgrade to continue enjoying premium benefits!`;

          if (member.email) {
            MailService.sendEmail(
              member.email,
              "Your Subscription Has Expired - Trusted Network",
              `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
            ).catch(e => console.error(`[Cron] Email error for ${member.email}:`, e.message));
          }

          if (member.fcmToken) {
            insertPushNotification({
              token: member.fcmToken,
              subject: "Subscription Expired",
              content: messageText,
              moduleName: NotificationModule.PLAN_EXPIRY,
              receiverId: member._id.toString()
            }).catch(e => console.error(`[Cron] Push error for member ${member._id}:`, e.message));
          }
        } catch (err: any) {
          console.error(`[Cron] Error processing expired sub ${sub._id}:`, err.message);
        }
      }
    }

    // ==========================================
    // 2. PROCESS SUBSCRIPTIONS ENDING IN 30 DAYS
    // ==========================================
    const thirtyDaysFromNowStart = new Date();
    thirtyDaysFromNowStart.setDate(thirtyDaysFromNowStart.getDate() + 30);
    thirtyDaysFromNowStart.setHours(0, 0, 0, 0);

    const thirtyDaysFromNowEnd = new Date();
    thirtyDaysFromNowEnd.setDate(thirtyDaysFromNowEnd.getDate() + 30);
    thirtyDaysFromNowEnd.setHours(23, 59, 59, 999);

    const expiringIn30DaysSubs = await this.subRepo.find({
      where: {
        endDate: {
          $gte: thirtyDaysFromNowStart,
          $lte: thirtyDaysFromNowEnd
        },
        status: "ACTIVE",
        isDeleted: false
      } as any
    });

    console.log(`[Cron] Found ${expiringIn30DaysSubs.length} subscriptions ending in 30 days.`);

    if (expiringIn30DaysSubs.length > 0) {
      const nonFreeSubs = expiringIn30DaysSubs.filter(s => s.type !== "FREE");
      const memberMap = await this.getMembersMap(nonFreeSubs.map(s => s.memberId));

      for (const sub of nonFreeSubs) {
        try {
          const member = memberMap.get(sub.memberId.toString());
          if (!member) continue;

          const messageText = "Your subscription plan will expire in 30 days. Renew your plan to continue enjoying Trusted Network benefits.";

          if (member.email) {
            MailService.sendEmail(
              member.email,
              "Plan Expiring Soon",
              `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
            ).catch(e => console.error(`[Cron 30d] Email error:`, e.message));
          }

          if (member.fcmToken) {
            insertPushNotification({
              token: member.fcmToken,
              subject: "Plan Expiring Soon",
              content: messageText,
              moduleName: NotificationModule.PLAN_EXPIRY,
              receiverId: member._id.toString()
            }).catch(e => console.error(`[Cron 30d] Push error:`, e.message));
          }
        } catch (err: any) {
          console.error(`[Cron] Error sending 30 days notification for sub ${sub._id}:`, err.message);
        }
      }
    }

    // ==========================================
    // 3. PROCESS SUBSCRIPTIONS ENDING IN 15 DAYS
    // ==========================================
    const fifteenDaysFromNowStart = new Date();
    fifteenDaysFromNowStart.setDate(fifteenDaysFromNowStart.getDate() + 15);
    fifteenDaysFromNowStart.setHours(0, 0, 0, 0);

    const fifteenDaysFromNowEnd = new Date();
    fifteenDaysFromNowEnd.setDate(fifteenDaysFromNowEnd.getDate() + 15);
    fifteenDaysFromNowEnd.setHours(23, 59, 59, 999);

    const expiringIn15DaysSubs = await this.subRepo.find({
      where: {
        endDate: {
          $gte: fifteenDaysFromNowStart,
          $lte: fifteenDaysFromNowEnd
        },
        status: "ACTIVE",
        isDeleted: false
      } as any
    });

    console.log(`[Cron] Found ${expiringIn15DaysSubs.length} subscriptions ending in 15 days.`);

    if (expiringIn15DaysSubs.length > 0) {
      const nonFreeSubs = expiringIn15DaysSubs.filter(s => s.type !== "FREE");
      const memberMap = await this.getMembersMap(nonFreeSubs.map(s => s.memberId));

      for (const sub of nonFreeSubs) {
        try {
          const member = memberMap.get(sub.memberId.toString());
          if (!member) continue;

          const messageText = "Your subscription plan will expire in 15 days. Renew your plan to continue enjoying Trusted Network benefits.";

          if (member.email) {
            MailService.sendEmail(
              member.email,
              "Plan Expiring Soon",
              `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
            ).catch(e => console.error(`[Cron 15d] Email error:`, e.message));
          }

          if (member.fcmToken) {
            insertPushNotification({
              token: member.fcmToken,
              subject: "Plan Expiring Soon",
              content: messageText,
              moduleName: NotificationModule.PLAN_EXPIRY,
              receiverId: member._id.toString()
            }).catch(e => console.error(`[Cron 15d] Push error:`, e.message));
          }
        } catch (err: any) {
          console.error(`[Cron] Error sending 15 days notification for sub ${sub._id}:`, err.message);
        }
      }
    }

    // ==========================================
    // 4. PROCESS SUBSCRIPTIONS ENDING SOON (IN 3 DAYS)
    // ==========================================
    const threeDaysFromNowStart = new Date();
    threeDaysFromNowStart.setDate(threeDaysFromNowStart.getDate() + 3);
    threeDaysFromNowStart.setHours(0, 0, 0, 0);

    const threeDaysFromNowEnd = new Date();
    threeDaysFromNowEnd.setDate(threeDaysFromNowEnd.getDate() + 3);
    threeDaysFromNowEnd.setHours(23, 59, 59, 999);

    const expiringSoonSubs = await this.subRepo.find({
      where: {
        endDate: {
          $gte: threeDaysFromNowStart,
          $lte: threeDaysFromNowEnd
        },
        status: "ACTIVE",
        isDeleted: false
      } as any
    });

    console.log(`[Cron] Found ${expiringSoonSubs.length} subscriptions ending in 3 days.`);

    if (expiringSoonSubs.length > 0) {
      const nonFreeSubs = expiringSoonSubs.filter(s => s.type !== "FREE");
      const memberMap = await this.getMembersMap(nonFreeSubs.map(s => s.memberId));

      for (const sub of nonFreeSubs) {
        try {
          const member = memberMap.get(sub.memberId.toString());
          if (!member) continue;

          const messageText = "Your subscription plan will expire in 3 days. Renew your plan to continue enjoying Trusted Network benefits.";

          if (member.email) {
            MailService.sendEmail(
              member.email,
              "Plan Expiring Soon",
              `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
            ).catch(e => console.error(`[Cron 3d] Email error:`, e.message));
          }

          if (member.fcmToken) {
            insertPushNotification({
              token: member.fcmToken,
              subject: "Plan Expiring Soon",
              content: messageText,
              moduleName: NotificationModule.PLAN_EXPIRY,
              receiverId: member._id.toString()
            }).catch(e => console.error(`[Cron 3d] Push error:`, e.message));
          }
        } catch (err: any) {
          console.error(`[Cron] Error sending ending soon notification for sub ${sub._id}:`, err.message);
        }
      }
    }
  }

  /**
   * Daily 10:00 AM Cron Job for active TRIAL plans only.
   * Calculates remaining days until trial expiry and sends push notification (e.g. "29 days left", "28 days left").
   */
  static async runTrialPlanDailyNotificationJob() {
    const now = new Date();

    const activeTrialSubs = await this.subRepo.find({
      where: {
        type: "TRIAL",
        status: "ACTIVE",
        isDeleted: false
      } as any
    });

    console.log(`[Cron 10:00 AM] Found ${activeTrialSubs.length} active TRIAL subscription(s).`);

    if (activeTrialSubs.length === 0) return;

    const memberMap = await this.getMembersMap(activeTrialSubs.map(s => s.memberId));

    for (const sub of activeTrialSubs) {
      try {
        if (!sub.endDate) continue;

        const endDate = new Date(sub.endDate);
        const diffTime = endDate.getTime() - now.getTime();
        const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (remainingDays <= 0) continue;

        const member = memberMap.get(sub.memberId.toString());
        if (!member) continue;

        const dayString = `${remainingDays} day${remainingDays > 1 ? "s" : ""} left`;
        const messageText = `Your Trial plan has ${dayString}. Upgrade now to retain all your premium benefits!`;

        if (member.fcmToken) {
          insertPushNotification({
            token: member.fcmToken,
            subject: `Trial Plan: ${dayString}`,
            content: messageText,
            moduleName: NotificationModule.TRIAL,
            receiverId: member._id.toString()
          }).catch(e => console.error(`[Cron Trial] Push error:`, e.message));
        }

        if (member.email) {
          MailService.sendEmail(
            member.email,
            `Trial Expiry Notice: ${dayString}`,
            `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
          ).catch(e => console.error(`[Cron Trial] Email error:`, e.message));
        }
      } catch (err: any) {
        console.error(`[Cron 10:00 AM] Error sending trial remaining days notification for sub ${sub._id}:`, err.message);
      }
    }
  }
}
