import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { SpotlightRequest, SpotlightRequestStatus } from "../entity/SpotlightRequest";
import { Spotlight, SpotlightStatus } from "../entity/Spotlight";
import { SpotlightHistory, SpotlightHistoryAction } from "../entity/SpotlightHistory";
// import { Member } from "../entity/Member";
// import { insertPushNotification } from "./pushnotification.service";
// import { NotificationModule } from "../entity/PushNotifications";

export class SpotlightRequestCronService {
  private static requestRepo = AppDataSource.getMongoRepository(SpotlightRequest);
  private static spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private static spotlightHistoryRepo = AppDataSource.getMongoRepository(SpotlightHistory);
  // private static memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * Initializes the Spotlight Request related cron jobs
   */
  static init() {
    console.log("⏰ Initializing Spotlight Request Cron Jobs...");

    // ✅ Daily 12:00 AM Cron - Auto Create Spotlight from Yesterday's First 50 Pending Requests
    cron.schedule("0 0 * * *", async () => {
      try {
        console.log("🕒 Running Daily Spotlight Creation Cron (12:00 AM)...");
        await this.createSpotlightFromYesterdayRequests();
      } catch (error: any) {
        console.error("❌ Daily Spotlight Creation Cron Failed:", error.message);
      }
    });

    // ✅ Hourly Cron - Soft Delete Expired Pending Requests (>48 hrs)
    cron.schedule("0 * * * *", async () => {
      try {
        console.log("🕒 Running Spotlight Request Cleanup Cron...");
        await this.softDeleteExpiredRequests();
      } catch (error: any) {
        console.error("❌ Spotlight Request Cleanup Cron Failed:", error.message);
      }
    });
  }

  /**
   * At 12:00 AM every day, find yesterday's first 50 members with PENDING status in SpotlightRequest
   * and insert a new Spotlight for today.
   */
  static async createSpotlightFromYesterdayRequests() {
    const now = new Date();

    // Calculate yesterday 00:00:00.000 to 23:59:59.999
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);

    const yesterdayEnd = new Date(now);
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // Find yesterday's first 50 pending requests
    const pendingRequests = await this.requestRepo.find({
      where: {
        status: SpotlightRequestStatus.PENDING,
        isDeleted: false,
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }
      } as any,
      order: { createdAt: "ASC" },
      take: 50
    });

    if (!pendingRequests || pendingRequests.length === 0) {
      console.log("⏭️ Spotlight Auto-Creation: No pending requests found for yesterday.");
      return;
    }

    const memberIds = pendingRequests.map(r => r.memberId);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Insert into Spotlight entity
    const spotlight = new Spotlight();
    spotlight.members = memberIds;
    spotlight.scheduleDate = today;
    spotlight.status = SpotlightStatus.ACTIVE;
    spotlight.isDeleted = false;

    const savedSpotlight = await this.spotlightRepo.save(spotlight);
    console.log(`✅ Spotlight Auto-Creation: Created new Spotlight (${savedSpotlight._id}) with ${memberIds.length} member(s).`);

    // Update pending requests to APPROVED and set assignedDate
    const requestIds = pendingRequests.map(r => r._id);
    await this.requestRepo.updateMany(
      { _id: { $in: requestIds } } as any,
      {
        $set: {
          status: SpotlightRequestStatus.APPROVED,
          assignedDate: today
        }
      }
    );

    // Create SpotlightHistory record & send Push Notification for each member
    for (const reqRecord of pendingRequests) {
      try {
        const history = new SpotlightHistory();
        history.memberId = reqRecord.memberId;
        history.action = SpotlightHistoryAction.ASSIGNED;
        history.scheduleDate = today;
        history.moduleId = savedSpotlight._id;
        history.msg = "Auto-assigned in daily spotlight from pending request.";
        await this.spotlightHistoryRepo.save(history);

        // Push notification to member if fcmToken exists
        // const member = await this.memberRepo.findOneBy({ _id: reqRecord.memberId, isDeleted: false });
        // if (member?.fcmToken) {
        //   await insertPushNotification({
        //     token: member.fcmToken,
        //     subject: "Spotlight Approved",
        //     content: "Your spotlight request has been approved and is active today!",
        //     moduleName: NotificationModule.SPOTLIGHT,
        //     moduleId: savedSpotlight._id.toString(),
        //     receiverId: reqRecord.memberId.toString()
        //   });
        // }
      } catch (err: any) {
        console.error(`Failed history/notification for member ${reqRecord.memberId}:`, err.message);
      }
    }
  }

  /**
   * Soft-deletes pending spotlight requests that were created
   * more than 48 hours ago and are still active.
   */
  static async softDeleteExpiredRequests() {
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

    const result = await this.requestRepo.updateMany(
      {
        status: SpotlightRequestStatus.PENDING,
        createdAt: { $lte: fortyEightHoursAgo },
        isDeleted: false
      },
      { $set: { isDeleted: true } }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `✅ Spotlight Request Cleanup: ${result.modifiedCount} expired pending request(s) soft-deleted.`
      );
    } else {
      console.log("⏭️  Spotlight Request Cleanup: No expired pending requests found.");
    }
  }
}
