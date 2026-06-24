import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Announcement, AnnouncementStatus } from "../entity/Announcement";

export class AnnouncementCronService {
  private static announcementRepo = AppDataSource.getMongoRepository(Announcement);

  /**
   * Initializes the Announcement activation and deactivation cron jobs.
   */
  static init() {
    console.log("⏰ Initializing Announcement Cron Jobs...");

    // ✅ Announcement Activation Cron - Runs every day at 12:01 AM
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Announcement Activation Cron...");
        await this.activateScheduledAnnouncements();
      } catch (error: any) {
        console.error("❌ Announcement Activation Cron Failed:", error.message);
      }
    });

    // ✅ Announcement Deactivation Cron - Runs every day at 12:01 AM
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Announcement Deactivation Cron...");
        await this.deactivateExpiredAnnouncements();
      } catch (error: any) {
        console.error("❌ Announcement Deactivation Cron Failed:", error.message);
      }
    });
  }

  /**
   * Activates announcements that are scheduled and whose scheduleDate has reached or passed.
   * Changes status from SCHEDULED → PUBLISHED.
   */
  static async activateScheduledAnnouncements() {
    const now = new Date();

    const result = await this.announcementRepo.updateMany(
      {
        scheduleDate: { $lte: now },
        status: AnnouncementStatus.SCHEDULED,
        isDeleted: false
      },
      { $set: { status: AnnouncementStatus.PUBLISHED } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Announcement Activation: ${result.modifiedCount} announcements set to published.`);
    }
  }

  /**
   * Deactivates announcements that are published or scheduled but whose event date has passed.
   * Changes status to INACTIVE.
   * Uses the `date` field (event/stall date) to determine expiry.
   */
  static async deactivateExpiredAnnouncements() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const result = await this.announcementRepo.updateMany(
      {
        date: { $lt: todayStart },
        status: { $in: [AnnouncementStatus.PUBLISHED, AnnouncementStatus.SCHEDULED] },
        isDeleted: false
      },
      { $set: { status: AnnouncementStatus.INACTIVE } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Announcement Deactivation: ${result.modifiedCount} announcements set to inactive.`);
    }
  }
}
