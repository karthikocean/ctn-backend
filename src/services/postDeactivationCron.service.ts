import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { PostModel, PostType } from "../entity/Post";

export class PostDeactivationCronService {
  private static get postRepo() {
    return AppDataSource.getMongoRepository(PostModel);
  }

  /**
   * Initializes the Post Deactivation cron job.
   * Runs on server startup and daily at 12:01 AM Asia/Kolkata
   * to deactivate posts of type PROMOTION and ASK older than 10 days.
   */
  static init() {
    console.log("⏰ Initializing Post Deactivation Cron Job...");

    // Run immediately on startup to deactivate any posts that expired during downtime
    this.deactivateExpiredPosts().catch((error: any) => {
      console.error("❌ Startup Post Deactivation Failed:", error.message);
    });

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
   * Deactivates posts of type PROMOTION and ASK
   * that were created more than 10 days ago and are still active.
   */
  static async deactivateExpiredPosts() {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    const result = await this.postRepo.updateMany(
      {
        type: { $in: [PostType.PROMOTION, PostType.ASK] },
        createdAt: { $lte: tenDaysAgo },
        isActive: true,
        isDeleted: false
      },
      {
        $set: {
          isActive: false,
          status: "inactive",
          statusReason: "Deactivated due to time expiration",
          updatedAt: new Date()
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
    return result;
  }
}

