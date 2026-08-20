import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { PostModel, PostType } from "../entity/Post";

export class PostDeactivationCronService {
  private static postRepo = AppDataSource.getMongoRepository(PostModel);

  /**
   * Initializes the Post Deactivation cron job.
   * Runs every day at 12:05 AM to deactivate (soft-delete) posts
   * of type PROMOTION and ASK that are older than 10 days.
   */
  static init() {
    console.log("⏰ Initializing Post Deactivation Cron Job...");

    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Post Deactivation Cron...");
        await this.deactivateExpiredPosts();
      } catch (error: any) {
        console.error("❌ Post Deactivation Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Deactivates (soft-deletes) posts of type PROMOTION and ASK
   * that were created more than 10 days ago and are still active.
   */
  static async deactivateExpiredPosts() {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    tenDaysAgo.setHours(0, 0, 0, 0);

    const result = await this.postRepo.updateMany(
      {
        type: { $in: [PostType.PROMOTION, PostType.ASK] },
        createdAt: { $lte: tenDaysAgo },
        isDeleted: false
      },
      {
        $set: {
          isActive: false,
          status: "inactive",
          statusReason: "Deactivated due to time expiration"
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `✅ Post Deactivation: ${result.modifiedCount} expired post(s) (Promotion/Ask) deactivated.`
      );
    } else {
      console.log("⏭️  Post Deactivation: No expired posts found.");
    }
  }
}
