import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Spotlight, SpotlightStatus } from "../entity/Spotlight";
import { ObjectId } from "mongodb";

export class SpotlightCronService {
  private static get spotlightRepo() {
    return AppDataSource.getMongoRepository(Spotlight);
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
   * Initializes the Spotlight related cron jobs
   */
  static init() {
    console.log("⏰ Initializing Spotlight Cron Jobs...");

    // Run startup check immediately to activate any spotlights due or expired during downtime
    this.activateScheduledSpotlights().catch((error: any) => {
      console.error("❌ Startup Spotlight Activation Failed:", error.message);
    });
    this.deactivateExpiredSpotlights().catch((error: any) => {
      console.error("❌ Startup Spotlight Deactivation Failed:", error.message);
    });

    // ✅ Spotlight Daily 12:01 AM Cron - Activates today's spotlights & deactivates yesterday's
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Daily Spotlight Activation & Deactivation Cron (12:01 AM)...");
        await this.activateScheduledSpotlights();
        await this.deactivateExpiredSpotlights();
      } catch (error: any) {
        console.error("❌ Spotlight Daily Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Activate spotlights scheduled for today or earlier (in Asia/Kolkata time)
   */
  static async activateScheduledSpotlights() {
    const todayEnd = this.getIstEndOfDay();

    const result = await this.spotlightRepo.updateMany(
      {
        scheduleDate: { $lte: todayEnd },
        status: SpotlightStatus.SCHEDULE,
        isDeleted: false
      },
      { $set: { status: SpotlightStatus.ACTIVE } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Spotlight Activation: ${result.modifiedCount} records set to active.`);
    }
    return result;
  }

  /**
   * Deactivate active spotlights whose scheduleDate has expired (past 24h and past scheduled day).
   */
  static async deactivateExpiredSpotlights() {
    try {
      const activeSpotlights = await this.spotlightRepo.find({
        where: {
          status: SpotlightStatus.ACTIVE,
          isDeleted: false
        }
      });

      if (!activeSpotlights || activeSpotlights.length === 0) return;

      const now = new Date();
      const deactivatedIds: ObjectId[] = [];

      for (const spotlight of activeSpotlights) {
        const scheduleEnd = this.getIstEndOfDay(spotlight.scheduleDate);
        const twentyFourHoursAfter = new Date(spotlight.scheduleDate.getTime() + 24 * 60 * 60 * 1000);
        // Spotlight expires after 24h or at the end of the scheduled IST day, whichever is later
        const expireTime = scheduleEnd > twentyFourHoursAfter ? scheduleEnd : twentyFourHoursAfter;

        if (now >= expireTime) {
          deactivatedIds.push(spotlight._id);
        }
      }

      if (deactivatedIds.length > 0) {
        const result = await this.spotlightRepo.updateMany(
          { _id: { $in: deactivatedIds } } as any,
          {
            $set: {
              status: SpotlightStatus.INACTIVE
            }
          }
        );

        if (result.modifiedCount > 0) {
          console.log(`✅ Spotlight Deactivation: ${result.modifiedCount} records set to inactive.`);
        }
        return result;
      }
    } catch (error: any) {
      console.error("❌ Spotlight Deactivation Failed:", error.message);
    }
  }
}
