import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Milestone } from "../entity/Milestone";

export class MilestoneCronService {
  private static milestoneRepo = AppDataSource.getMongoRepository(Milestone);

  /**
   * Initializes the Milestone cleanup cron job.
   * Runs every hour to soft-delete milestones
   * that are older than 48 hours from their createdAt date.
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
    });
  }

  /**
   * Soft-deletes milestones that were created
   * more than 48 hours ago and are still active.
   */
  static async softDeleteExpiredMilestones() {
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

    const result = await this.milestoneRepo.updateMany(
      {
        createdAt: { $lte: fortyEightHoursAgo },
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
