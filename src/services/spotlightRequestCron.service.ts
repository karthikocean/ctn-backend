import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { SpotlightRequest, SpotlightRequestStatus } from "../entity/SpotlightRequest";
import { Spotlight, SpotlightStatus } from "../entity/Spotlight";
import { SpotlightHistory, SpotlightHistoryAction } from "../entity/SpotlightHistory";

export class SpotlightRequestCronService {
  private static get requestRepo() {
    return AppDataSource.getMongoRepository(SpotlightRequest);
  }
  private static get spotlightRepo() {
    return AppDataSource.getMongoRepository(Spotlight);
  }
  private static get spotlightHistoryRepo() {
    return AppDataSource.getMongoRepository(SpotlightHistory);
  }

  /**
   * Helper to get start of day (00:00:00.000) in Asia/Kolkata timezone converted to UTC Date
   */
  static getIstStartOfDay(date: Date = new Date()): Date {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(date.getTime() + istOffset);
    const year = istTime.getUTCFullYear();
    const month = istTime.getUTCMonth();
    const day = istTime.getUTCDate();
    return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - istOffset);
  }

  /**
   * Helper to get end of day (23:59:59.999) in Asia/Kolkata timezone converted to UTC Date
   */
  static getIstEndOfDay(date: Date = new Date()): Date {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(date.getTime() + istOffset);
    const year = istTime.getUTCFullYear();
    const month = istTime.getUTCMonth();
    const day = istTime.getUTCDate();
    return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - istOffset);
  }

  /**
   * Initializes the Spotlight Request related cron jobs
   */
  static init() {
    console.log("⏰ Initializing Spotlight Request Cron Jobs...");

    // Run startup check immediately
    this.createSpotlightFromYesterdayRequests().catch((error: any) => {
      console.error("❌ Startup Spotlight Auto-Creation Failed:", error.message);
    });

    // ✅ Daily 1:00 AM Cron - Auto Create Spotlight from Pending Requests
    cron.schedule("0 1 * * *", async () => {
      try {
        console.log("🕒 Running Daily Spotlight Creation Cron (1:00 AM)...");
        await this.createSpotlightFromYesterdayRequests();
      } catch (error: any) {
        console.error("❌ Daily Spotlight Creation Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });

    // ✅ Hourly Cron - Soft Delete Expired Pending Requests (>48 hrs)
    cron.schedule("0 * * * *", async () => {
      try {
        console.log("🕒 Running Spotlight Request Cleanup Cron...");
        await this.softDeleteExpiredRequests();
      } catch (error: any) {
        console.error("❌ Spotlight Request Cleanup Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * At 1:00 AM every day, find members with PENDING status in SpotlightRequest created up to yesterday
   * and insert/update a Spotlight for today with status ACTIVE.
   */
  static async createSpotlightFromYesterdayRequests() {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + istOffset);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const date = istNow.getUTCDate();

    // Start & end of today in IST
    const todayStart = new Date(Date.UTC(year, month, date, 0, 0, 0, 0) - istOffset);
    const todayEnd = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - istOffset);
    // End of yesterday in IST
    const yesterdayEnd = new Date(Date.UTC(year, month, date - 1, 23, 59, 59, 999) - istOffset);

    // Find pending requests created up to end of yesterday (FIFO, max 50)
    const pendingRequests = await this.requestRepo.find({
      where: {
        status: SpotlightRequestStatus.PENDING,
        isDeleted: false,
        createdAt: { $lte: yesterdayEnd }
      } as any,
      order: { createdAt: "ASC" },
      take: 50
    });

    if (!pendingRequests || pendingRequests.length === 0) {
      console.log("⏭️ Spotlight Auto-Creation: No pending requests found up to yesterday.");
      return;
    }

    const memberIds = pendingRequests.map(r => r.memberId);

    // Check if a spotlight already exists for today
    let spotlight = await this.spotlightRepo.findOne({
      where: {
        scheduleDate: { $gte: todayStart, $lte: todayEnd } as any,
        isDeleted: false
      }
    });

    let savedSpotlight: Spotlight;
    if (spotlight) {
      const existingMembers = new Set(spotlight.members.map(m => m.toString()));
      for (const mId of memberIds) {
        if (!existingMembers.has(mId.toString())) {
          spotlight.members.push(mId);
        }
      }
      spotlight.status = SpotlightStatus.ACTIVE;
      savedSpotlight = await this.spotlightRepo.save(spotlight);
    } else {
      spotlight = new Spotlight();
      spotlight.members = memberIds;
      spotlight.scheduleDate = todayStart;
      spotlight.status = SpotlightStatus.ACTIVE;
      spotlight.isDeleted = false;
      savedSpotlight = await this.spotlightRepo.save(spotlight);
    }

    console.log(`✅ Spotlight Auto-Creation: Updated/Created Spotlight (${savedSpotlight._id}) with ${savedSpotlight.members.length} member(s).`);

    // Update pending requests to APPROVED and set assignedDate
    const requestIds = pendingRequests.map(r => r._id);
    await this.requestRepo.updateMany(
      { _id: { $in: requestIds } } as any,
      {
        $set: {
          status: SpotlightRequestStatus.APPROVED,
          assignedDate: todayStart
        }
      }
    );

    // Create SpotlightHistory record for each member
    for (const reqRecord of pendingRequests) {
      try {
        const history = new SpotlightHistory();
        history.memberId = reqRecord.memberId;
        history.action = SpotlightHistoryAction.ASSIGNED;
        history.scheduleDate = todayStart;
        history.moduleId = savedSpotlight._id;
        history.msg = "Auto-assigned in daily spotlight from pending request.";
        await this.spotlightHistoryRepo.save(history);
      } catch (err: any) {
        console.error(`Failed history for member ${reqRecord.memberId}:`, err.message);
      }
    }

    return savedSpotlight;
  }

  /**
   * Soft-deletes pending spotlight requests that were created
   * more than 48 hours ago and are still pending.
   */
  static async softDeleteExpiredRequests() {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

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
    return result;
  }
}
