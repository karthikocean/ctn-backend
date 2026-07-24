import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Announcement, AnnouncementStatus } from "../entity/Announcement";
import { notifyAnnouncementAudience } from "./pushnotification.service";

export class AnnouncementCronService {
  private static announcementRepo = AppDataSource.getMongoRepository(Announcement);

  /**
   * Initializes the Announcement activation and deactivation cron jobs.
   */
  static init() {
    console.log("⏰ Initializing Announcement Cron Jobs...");

    // ✅ Announcement Activation Cron - Runs every minute
    cron.schedule("* * * * *", async () => {
      try {
        await this.activateScheduledAnnouncements();
      } catch (error: any) {
        console.error("❌ Announcement Activation Cron Failed:", error.message);
      }
    });

    // ✅ Announcement Deactivation Cron - Runs every minute
    cron.schedule("* * * * *", async () => {
      try {
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

    const scheduledItems = await this.announcementRepo.find({
      where: {
        scheduleDate: { $lte: now },
        status: AnnouncementStatus.SCHEDULED,
        isDeleted: false
      } as any
    });

    if (scheduledItems.length > 0) {
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

        for (const item of scheduledItems) {
          notifyAnnouncementAudience({
            announcementId: item._id.toString(),
            title: item.title,
            content: item.content,
            regionId: item.regionId ? item.regionId.toString() : undefined,
            regionIds: item.regionIds ? item.regionIds.map((id: any) => id.toString()) : undefined,
            senderId: item.createdBy ? item.createdBy.toString() : undefined
          }).catch(err => console.error("Error notifying scheduled announcement:", err));
        }
      }
    }
  }

  /**
   * Deactivates announcements that are published or scheduled but whose event date has passed.
   * Changes status to INACTIVE.
   * Uses `toDate` or `date` to determine expiry against the current timestamp.
   */
  static async deactivateExpiredAnnouncements() {
    const now = new Date();

    const result = await this.announcementRepo.updateMany(
      {
        $or: [
          { toDate: { $lt: now } },
          {
            $and: [
              { toDate: { $exists: false } },
              { date: { $lt: now } }
            ]
          }
        ],
        status: { $in: [AnnouncementStatus.PUBLISHED, AnnouncementStatus.SCHEDULED] },
        isDeleted: false
      },
      { $set: { status: AnnouncementStatus.EXPIRED } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Announcement Deactivation: ${result.modifiedCount} announcements set to inactive.`);
    }
  }
}
