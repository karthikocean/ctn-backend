import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Spotlight, SpotlightStatus } from "../entity/Spotlight";

export class SpotlightCronService {
  private static spotlightRepo = AppDataSource.getMongoRepository(Spotlight);

  /**
   * Initializes the Spotlight related cron jobs
   */
  static init() {
    console.log("⏰ Initializing Spotlight Cron Jobs...");

    // ✅ Spotlight Activation Cron - Runs every day at 12:01 AM
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Spotlight Activation Cron...");
        await this.activateScheduledSpotlights();
      } catch (error: any) {
        console.error("❌ Spotlight Activation Cron Failed:", error.message);
      }
    });

    // ✅ Spotlight Deactivation Cron - Runs every minute
    cron.schedule("* * * * *", async () => {
      try {
        await this.deactivateExpiredSpotlights();
      } catch (error: any) {
        console.error("❌ Spotlight Deactivation Cron Failed:", error.message);
      }
    });
  }

  /**
   * Activate spotlights scheduled for today or earlier
   */
  static async activateScheduledSpotlights() {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

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
  }

  /**
   * Deactivate active spotlights whose scheduleDate was strictly before today (yesterday or earlier)
   */
  static async deactivateExpiredSpotlights() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const result = await this.spotlightRepo.updateMany(
      {
        status: SpotlightStatus.ACTIVE,
        scheduleDate: { $lt: todayStart },
        isDeleted: false
      },
      {
        $set: {
          status: SpotlightStatus.INACTIVE
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Spotlight Deactivation: ${result.modifiedCount} records set to inactive.`);
    }
  }
}
