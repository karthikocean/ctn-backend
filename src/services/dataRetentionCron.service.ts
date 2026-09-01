import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { PostModel } from "../entity/Post";
import { SavedPost } from "../entity/SavedPost";
import { PostReport } from "../entity/PostReport";
import imageService from "../utils/upload";

export class DataRetentionCronService {
  private static postRepo = AppDataSource.getMongoRepository(PostModel);
  private static savedPostRepo = AppDataSource.getMongoRepository(SavedPost);
  private static postReportRepo = AppDataSource.getMongoRepository(PostReport);

  /**
   * Initializes the 1-Year Data Retention cron job.
   * Runs daily at 1:00 AM Asia/Kolkata to permanently remove posts,
   * saved posts, and associated S3 media files older than 1 year.
   */
  static init() {
    console.log("⏰ Initializing Data Retention Cron Job (1:00 AM)...");

    cron.schedule("0 1 * * *", async () => {
      try {
        console.log("🕒 Running 1-Year Data Retention & S3 Cleanup Cron (01:00 AM)...");
        await this.cleanupExpiredData();
      } catch (error: any) {
        console.error("❌ Data Retention Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Cleans up posts, saved posts, and S3 media older than 1 year.
   */
  static async cleanupExpiredData() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    console.log(`[DataRetention] Running 1-year retention cleanup for data created before: ${oneYearAgo.toISOString()}`);

    // 1. Find all posts created > 1 year ago
    const expiredPosts = await this.postRepo.find({
      where: {
        createdAt: { $lte: oneYearAgo }
      } as any
    });

    console.log(`[DataRetention] Found ${expiredPosts.length} post(s) older than 1 year.`);

    if (expiredPosts.length > 0) {
      const expiredPostIds = expiredPosts.map((p) => p._id);

      // Collect all S3 media files to delete
      const mediaFilesToDelete: string[] = [];
      for (const post of expiredPosts) {
        if (post.media && Array.isArray(post.media)) {
          for (const m of post.media) {
            if (typeof m === "string" && m.trim().length > 0) {
              mediaFilesToDelete.push(m.trim());
            }
          }
        }
      }

      // Delete media files from S3 bucket
      if (mediaFilesToDelete.length > 0) {
        console.log(`[DataRetention] Deleting ${mediaFilesToDelete.length} media file(s) from S3...`);
        try {
          await imageService.cleanupFiles(mediaFilesToDelete);
          console.log(`✅ [DataRetention] Successfully deleted ${mediaFilesToDelete.length} S3 media files.`);
        } catch (s3Err: any) {
          console.error("⚠️ [DataRetention] Error deleting S3 media files:", s3Err.message || s3Err);
        }
      }

      // Delete saved posts referencing these expired posts
      const deletedSavedRefResult = await this.savedPostRepo.deleteMany({
        postId: { $in: expiredPostIds }
      } as any);
      console.log(`[DataRetention] Deleted ${deletedSavedRefResult.deletedCount || 0} saved post reference(s) for expired posts.`);

      // Delete post reports referencing these expired posts
      try {
        const deletedReportsResult = await this.postReportRepo.deleteMany({
          postId: { $in: expiredPostIds }
        } as any);
        console.log(`[DataRetention] Deleted ${deletedReportsResult.deletedCount || 0} post report(s) for expired posts.`);
      } catch (err: any) {
        console.warn("⚠️ [DataRetention] Error deleting post reports:", err.message);
      }

      // Delete the posts permanently from DB
      const deletedPostsResult = await this.postRepo.deleteMany({
        _id: { $in: expiredPostIds }
      } as any);
      console.log(`✅ [DataRetention] Permanently deleted ${deletedPostsResult.deletedCount || expiredPosts.length} expired post(s) from database.`);
    }

    // 2. Also delete any saved posts created > 1 year ago (if not already deleted)
    const deletedOldSavedPostsResult = await this.savedPostRepo.deleteMany({
      createdAt: { $lte: oneYearAgo }
    } as any);
    if ((deletedOldSavedPostsResult.deletedCount || 0) > 0) {
      console.log(`✅ [DataRetention] Deleted ${deletedOldSavedPostsResult.deletedCount} saved post(s) older than 1 year.`);
    }

    console.log("🏁 [DataRetention] 1-Year Data Retention cleanup completed.");
    return {
      expiredPostsCount: expiredPosts.length
    };
  }
}
