import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Spotlight, SpotlightStatus } from "../entity/Spotlight";
import { ObjectId } from "mongodb";

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
    // cron.schedule("* * * * *", async () => {
    //   try {
    //     await this.deactivateExpiredSpotlights();
    //   } catch (error: any) {
    //     console.error("❌ Spotlight Deactivation Cron Failed:", error.message);
    //   }
    // });
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
   * Deactivate active spotlights whose scheduleDate has expired (older than 24 hours).
   */
  static async deactivateExpiredSpotlights() {
    try {
      const activeSpotlights = await this.spotlightRepo.find({
        where: {
          status: SpotlightStatus.ACTIVE,
          isDeleted: false
        }
      });

      if (activeSpotlights.length === 0) return;

      const now = new Date();
      const deactivatedIds: ObjectId[] = [];

      for (const spotlight of activeSpotlights) {
        const expireTime = new Date(spotlight.scheduleDate.getTime() + 24 * 60 * 60 * 1000);

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
      }
    } catch (error: any) {
      console.error("❌ Spotlight Deactivation Failed:", error.message);
    }
  }
}
