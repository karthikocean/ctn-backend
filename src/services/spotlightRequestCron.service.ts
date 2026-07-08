import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { SpotlightRequest, SpotlightRequestStatus } from "../entity/SpotlightRequest";

export class SpotlightRequestCronService {
  private static requestRepo = AppDataSource.getMongoRepository(SpotlightRequest);

  /**
   * Initializes the Spotlight Request cleanup cron job.
   * Runs every hour to soft-delete pending spotlight requests
   * that are older than 48 hours from their createdAt date.
   */
  static init() {
    console.log("⏰ Initializing Spotlight Request Cleanup Cron Job...");

    // Runs every hour at minute 0
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
