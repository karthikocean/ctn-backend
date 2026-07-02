import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { MemberSubscription } from "../entity/MemberSubscription";
import { Plan } from "../entity/Plan";
import { insertPushNotification } from "./pushnotification.service";
import { MailService } from "./mail.service";
import cron from "node-cron";
import { NotificationModule } from "../entity/PushNotifications";

export class SubscriptionCronService {
  private static memberRepo = AppDataSource.getMongoRepository(Member);
  private static subRepo = AppDataSource.getMongoRepository(MemberSubscription);
  // private static planRepo = AppDataSource.getMongoRepository(Plan);

  /**
   * Initializes the cron job to run daily at 12:01 AM
   */
  static init() {
    console.log("⏰ Initializing Subscription Daily Cron Job...");
    // Run daily at 12:01 AM: "1 0 * * *"
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Subscription Expiration Cron...");
        await this.runDailySubscriptionJob();
      } catch (error: any) {
        console.error("❌ Subscription Expiration Cron Failed:", error.message);
      }
    });
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

    for (const sub of expiredSubscriptions) {
      try {
        // Expire subscription
        sub.status = "EXPIRED";
        await this.subRepo.save(sub);

        // Fetch Member
        const member = await this.memberRepo.findOneBy({ _id: sub.memberId, isDeleted: false });
        if (!member) continue;

        // Downgrade member to Guest access by clearing subscriptionId and planId
        member.subscriptionId = null as any;
        member.planId = null as any;
        await this.memberRepo.save(member);

        // Notify member
        const messageText = `Your ${sub.type} subscription expired today and has been downgraded to Guest Access. Upgrade to continue enjoying premium benefits!`;

        // Email
        if (member.email) {
          await MailService.sendEmail(
            member.email,
            "Your Subscription Has Expired - Trusted Network",
            `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
          );
        }

        // Push
        if (member.fcmToken) {
          await insertPushNotification({
            token: member.fcmToken,
            subject: "Subscription Expired",
            content: messageText,
            moduleName: NotificationModule.PLAN_EXPIRY,
            receiverId: member._id.toString()
          });
        }
      } catch (err: any) {
        console.error(`[Cron] Error processing expired sub ${sub._id}:`, err.message);
      }
    }

    // ==========================================
    // 2. PROCESS SUBSCRIPTIONS ENDING SOON (IN 3 DAYS)
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

    for (const sub of expiringSoonSubs) {
      // Do not remind FREE plans
      if (sub.type === "FREE") continue;

      try {
        const member = await this.memberRepo.findOneBy({ _id: sub.memberId, isDeleted: false });
        if (!member) continue;

        const planName = sub.type === "TRIAL" ? "Trial Period" : `${sub.type} Subscription`;
        const messageText = `Your ${planName} is ending soon in 3 days. Renew or upgrade now to retain all your premium benefits!`;

        // Email
        if (member.email) {
          await MailService.sendEmail(
            member.email,
            "Action Required: Your Subscription Ends in 3 Days",
            `<p>Dear ${member.fullName},</p><p>${messageText}</p><p>Best regards,<br>Trusted Network Support</p>`
          );
        }

        // Push
        if (member.fcmToken) {
          await insertPushNotification({
            token: member.fcmToken,
            subject: "Subscription Ending Soon",
            content: messageText,
            moduleName: NotificationModule.PLAN_EXPIRY,
            receiverId: member._id.toString()
          });
        }
      } catch (err: any) {
        console.error(`[Cron] Error sending ending soon notification for sub ${sub._id}:`, err.message);
      }
    }
  }
}
