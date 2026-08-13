import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { DailyScoreHistory } from "../entity/DailyScoreHistory";
import { NotificationModule, PushNotification } from "../entity/PushNotifications";
import { sendPushNotification } from "./pushnotification.service";

export class DailyTaskCronService {
  private static memberRepo = AppDataSource.getMongoRepository(Member);
  private static dailyScoreHistoryRepo = AppDataSource.getMongoRepository(DailyScoreHistory);
  private static notificationRepo = AppDataSource.getMongoRepository(PushNotification);

  /**
   * Initializes the Daily Task Reminder Cron Jobs
   */
  static init() {
    console.log("⏰ Initializing Daily Task Reminder Cron Jobs...");

    // 1. Cron job for 11:00 AM: "0 11 * * *" (Runs only once daily at 11:00 AM IST)
    cron.schedule("0 11 * * *", async () => {
      try {
        console.log("🕒 Running Daily Task Reminder Cron (11:00 AM)...");
        await this.processDailyTaskReminders();
      } catch (error: any) {
        console.error("❌ Daily Task Reminder Cron (11:00 AM) Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });

    // 2. Cron job for 4:00 PM: "0 16 * * *"
    cron.schedule("0 16 * * *", async () => {
      try {
        console.log("🕒 Running Daily Task Reminder Cron (4:00 PM)...");
        await this.processDailyTaskReminders();
      } catch (error: any) {
        console.error("❌ Daily Task Reminder Cron (4:00 PM) Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });

    // // 3. Cron job for 6:00 PM: "0 18 * * *"
    // cron.schedule("0 18 * * *", async () => {
    //   try {
    //     console.log("🕒 Running Daily Task Reminder Cron (6:00 PM)...");
    //     await this.processDailyTaskReminders();
    //   } catch (error: any) {
    //     console.error("❌ Daily Task Reminder Cron (6:00 PM) Failed:", error.message);
    //   }
    // }, {
    //   timezone: "Asia/Kolkata"
    // });

    // // 4. Cron job for 10:00 PM: "0 22 * * *"
    // cron.schedule("0 22 * * *", async () => {
    //   try {
    //     console.log("🕒 Running Daily Task Reminder Cron (10:00 PM)...");
    //     await this.processDailyTaskReminders();
    //   } catch (error: any) {
    //     console.error("❌ Daily Task Reminder Cron (10:00 PM) Failed:", error.message);
    //   }
    // }, {
    //   timezone: "Asia/Kolkata"
    // });
  }

  /**
   * Processes members who have not completed daily tasks today and sends them reminders.
   */
  static async processDailyTaskReminders() {
    // Get local date string YYYY-MM-DD (IST)
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const now = new Date(new Date().getTime() + IST_OFFSET);
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    console.log(`[DailyTaskCron] Processing reminders for date: ${dateStr}`);

    // 1. Fetch all active, non-deleted members
    const activeMembers = await this.memberRepo.find({
      where: {
        status: MemberStatus.ACTIVE,
        isDeleted: false
      } as any
    });

    if (activeMembers.length === 0) {
      console.log("[DailyTaskCron] No active members to check.");
      return;
    }

    // 2. Fetch all daily score history records for today
    const histories = await this.dailyScoreHistoryRepo.find({
      where: {
        date: dateStr,
        moduleName: { $in: ["Post", "Ask", "Give", "Requirement"] }
      } as any
    });

    // 3. Map completed modules by member
    const completedTasksByMember = new Map<string, Set<string>>();
    for (const history of histories) {
      const memberIdStr = history.memberId.toString();
      if (!completedTasksByMember.has(memberIdStr)) {
        completedTasksByMember.set(memberIdStr, new Set());
      }
      completedTasksByMember.get(memberIdStr)!.add(history.moduleName);
    }

    // 4. Identify members who have not completed all four tasks
    const requiredTasks = ["Post", "Ask", "Give", "Requirement"];
    const membersToNotify = activeMembers.filter(member => {
      const completed = completedTasksByMember.get(member._id.toString()) || new Set();
      // If any of the required tasks is not completed, they should be notified
      return requiredTasks.some(task => !completed.has(task));
    });

    console.log(`[DailyTaskCron] Found ${membersToNotify.length} members out of ${activeMembers.length} who have not completed all daily tasks.`);

    if (membersToNotify.length === 0) {
      console.log("[DailyTaskCron] All active members have completed their daily tasks.");
      return;
    }

    // 5. Bulk insert notification records into DB
    const subject = "Daily Task Reminder";
    const content = "Your daily task is still pending. Kindly complete it to earn your daily score.";

    const notifications = membersToNotify.map(member => ({
      sub: subject,
      msg: content,
      moduleName: NotificationModule.DAILY_TASK,
      receiverId: member._id,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    await this.notificationRepo.insertMany(notifications);
    console.log(`[DailyTaskCron] Bulk inserted ${notifications.length} notification records into push_notifications.`);

    // 6. Send FCM push notifications in batches to those who have tokens
    const membersWithToken = membersToNotify.filter(m => m.fcmToken);
    console.log(`[DailyTaskCron] Dispatching FCM push notifications to ${membersWithToken.length} members...`);

    const batchSize = 100;
    for (let i = 0; i < membersWithToken.length; i += batchSize) {
      const batch = membersWithToken.slice(i, i + batchSize);
      await Promise.all(
        batch.map(member =>
          sendPushNotification(member.fcmToken!, subject, {
            content: content,
            moduleName: NotificationModule.DAILY_TASK
          }).catch(err =>
            console.error(`[DailyTaskCron] FCM failed for member ${member._id}:`, err.message)
          )
        )
      );
    }
    console.log("[DailyTaskCron] FCM push notification dispatch completed.");
  }
}
