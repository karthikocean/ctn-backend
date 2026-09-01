import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Milestone } from "../entity/Milestone";
import { MilestoneView } from "../entity/MilestoneView";
import imageService from "../utils/upload";

export class MilestoneCronService {
  private static milestoneRepo = AppDataSource.getMongoRepository(Milestone);
  private static milestoneViewRepo = AppDataSource.getMongoRepository(MilestoneView);

  /**
   * Initializes the Milestone cleanup cron job.
   * Runs every 10 minutes to permanently delete expired milestones (24 hours),
   * remove associated S3 media files, and clean up view/reaction records.
   */
  static init() {
    console.log("⏰ Initializing Milestone Cleanup Cron Job...");

    // Runs every 10 minutes
    cron.schedule("*/10 * * * *", async () => {
      try {
        console.log("🕒 Running Milestone Cleanup Cron...");
        await this.deleteExpiredMilestones();
      } catch (error: any) {
        console.error("❌ Milestone Cleanup Cron Failed:", error.message);
      }
    }, {
      timezone: "Asia/Kolkata"
    });
  }

  /**
   * Permanently deletes milestones that are older than 24 hours (or past expiresAt),
   * purges their S3 media files, and removes related view records.
   */
  static async deleteExpiredMilestones() {
    const now = new Date();
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // 1. Find all expired milestones (either expiresAt <= now OR createdAt <= 24 hours ago)
    const expiredMilestones = await this.milestoneRepo.find({
      where: {
        $or: [
          { expiresAt: { $lte: now } },
          { createdAt: { $lte: twentyFourHoursAgo } },
          { isDeleted: true }
        ]
      } as any
    });

    if (expiredMilestones.length === 0) {
      console.log("⏭️  Milestone Cleanup: No expired milestones found.");
      return { deletedCount: 0, mediaDeletedCount: 0 };
    }

    const expiredMilestoneIds = expiredMilestones.map((m) => m._id);

    // 2. Collect all S3 media URLs to delete
    const mediaFilesToDelete: string[] = [];
    for (const milestone of expiredMilestones) {
      if (milestone.mediaUrl && typeof milestone.mediaUrl === "string" && milestone.mediaUrl.trim().length > 0) {
        mediaFilesToDelete.push(milestone.mediaUrl.trim());
      }
    }

    // 3. Clear S3 media files
    if (mediaFilesToDelete.length > 0) {
      try {
        console.log(`[MilestoneCleanup] Deleting ${mediaFilesToDelete.length} media file(s) from S3...`);
        await imageService.cleanupFiles(mediaFilesToDelete);
        console.log(`✅ [MilestoneCleanup] Successfully purged ${mediaFilesToDelete.length} milestone media files from S3.`);
      } catch (s3Err: any) {
        console.error("⚠️ [MilestoneCleanup] Error deleting S3 media files:", s3Err.message || s3Err);
      }
    }

    // 4. Delete associated milestone views and reactions
    try {
      const deletedViews = await this.milestoneViewRepo.deleteMany({
        milestoneId: { $in: expiredMilestoneIds }
      } as any);
      console.log(`[MilestoneCleanup] Deleted ${deletedViews.deletedCount || 0} milestone view/reaction record(s).`);
    } catch (viewErr: any) {
      console.warn("⚠️ [MilestoneCleanup] Error deleting milestone views:", viewErr.message);
    }

    // 5. Permanently delete milestone records from database
    const deleteResult = await this.milestoneRepo.deleteMany({
      _id: { $in: expiredMilestoneIds }
    } as any);

    console.log(
      `✅ Milestone Cleanup: ${deleteResult.deletedCount || expiredMilestones.length} expired milestone(s) permanently deleted.`
    );

    return {
      deletedCount: deleteResult.deletedCount || expiredMilestones.length,
      mediaDeletedCount: mediaFilesToDelete.length
    };
  }

  /**
   * Alias for backward-compatibility if referenced elsewhere.
   */
  static async softDeleteExpiredMilestones() {
    return this.deleteExpiredMilestones();
  }
}
