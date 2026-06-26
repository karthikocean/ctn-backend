import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { PostModel, PostType } from "../entity/Post";

export class PostDeactivationCronService {
  private static postRepo = AppDataSource.getMongoRepository(PostModel);

  /**
   * Initializes the Post Deactivation cron job.
   * Runs every day at 12:05 AM to deactivate (soft-delete) posts
   * of type PROMOTION, ASK, and GIVE that are older than 9 days.
   */
  static init() {
    console.log("⏰ Initializing Post Deactivation Cron Job...");

    cron.schedule("5 0 * * *", async () => {
      try {
        console.log("🕒 Running Post Deactivation Cron...");
        await this.deactivateExpiredPosts();
      } catch (error: any) {
        console.error("❌ Post Deactivation Cron Failed:", error.message);
      }
    });
  }

  /**
   * Deactivates (soft-deletes) posts of type PROMOTION, ASK, and GIVE
   * that were created more than 9 days ago and are still active.
   */
  static async deactivateExpiredPosts() {
    const nineDaysAgo = new Date();
    nineDaysAgo.setDate(nineDaysAgo.getDate() - 9);
    nineDaysAgo.setHours(0, 0, 0, 0);

    const result = await this.postRepo.updateMany(
      {
        type: { $in: [PostType.PROMOTION, PostType.ASK, PostType.GIVE] },
        createdAt: { $lte: nineDaysAgo },
        isDeleted: false
      },
      { $set: { isDeleted: true } }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `✅ Post Deactivation: ${result.modifiedCount} expired post(s) (Promotion/Ask/Give) deactivated.`
      );
    } else {
      console.log("⏭️  Post Deactivation: No expired posts found.");
    }
  }
}
