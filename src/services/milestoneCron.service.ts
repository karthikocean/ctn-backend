import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Milestone } from "../entity/Milestone";

export class MilestoneCronService {
  private static milestoneRepo = AppDataSource.getMongoRepository(Milestone);

  /**
   * Initializes the Milestone cleanup cron job.
   * Runs every 10 minutes to soft-delete milestones
   * that are older than 24 hours from their createdAt date.
   */
  static init() {
    console.log("⏰ Initializing Milestone Cleanup Cron Job...");

    // Runs every 10 minutes
    cron.schedule("*/10 * * * *", async () => {
      try {
        console.log("🕒 Running Milestone Cleanup Cron...");
        await this.softDeleteExpiredMilestones();
      } catch (error: any) {
        console.error("❌ Milestone Cleanup Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Soft-deletes milestones that were created
   * more than 24 hours ago and are still active.
   */
  static async softDeleteExpiredMilestones() {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const result = await this.milestoneRepo.updateMany(
      {
        createdAt: { $lte: twentyFourHoursAgo },
        isDeleted: false
      },
      { $set: { isDeleted: true } }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `✅ Milestone Cleanup: ${result.modifiedCount} expired milestone(s) soft-deleted.`
      );
    } else {
      console.log("⏭️  Milestone Cleanup: No expired milestones found.");
    }
  }
}
