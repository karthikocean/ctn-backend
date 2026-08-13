import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { insertPushNotification } from "./pushnotification.service";
import { NotificationModule } from "../entity/PushNotifications";

export class AnniversaryCronService {
  private static memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * Initializes the Anniversary cron job — runs every day at 8:00 AM
   */
  static init() {
    console.log("🎉 Initializing Registration Anniversary Cron Job...");

    // Runs every day at 8:00 AM
    cron.schedule("0 8 * * *", async () => {
      try {
        console.log("🎉 Running Registration Anniversary Cron...");
        await this.processAnniversaries();
      } catch (error: any) {
        console.error("❌ Registration Anniversary Cron Failed:", error.message);
      }
    });
  }

  /**
   * Finds all members celebrating their registration anniversary today and sends notifications strictly to those members
   */
  static async processAnniversaries() {
    const now = new Date();
    const todayMonth = now.getMonth() + 1; // 1-based month
    const todayDay = now.getDate();
    const todayYear = now.getFullYear();

    console.log(`[AnniversaryCron] Checking registration anniversaries for ${todayDay}/${todayMonth}`);

    // Fetch all active members
    const allMembers = await this.memberRepo.find({
      where: { isDeleted: false, status: MemberStatus.ACTIVE } as any
    });

    // Filter members whose registration (createdAt) day and month match today and at least 1 year has passed
    const anniversaryMembers = allMembers.filter((member) => {
      if (!member.createdAt) return false;
      const createdDate = new Date(member.createdAt);
      const isSameDayAndMonth =
        createdDate.getDate() === todayDay && createdDate.getMonth() + 1 === todayMonth;
      const isPastYear = todayYear > createdDate.getFullYear();
      return isSameDayAndMonth && isPastYear;
    });

    if (anniversaryMembers.length === 0) {
      console.log("[AnniversaryCron] No registration anniversaries today.");
      return;
    }

    console.log(`[AnniversaryCron] Found ${anniversaryMembers.length} registration anniversary(ies) today.`);

    for (const member of anniversaryMembers) {
      try {
        // Send direct anniversary notification strictly to the particular member
        await this.notifyAnniversaryMember(member);
      } catch (err: any) {
        console.error(
          `[AnniversaryCron] Failed to process anniversary for member ${member._id}:`,
          err.message
        );
      }
    }
  }

  /**
   * Sends direct anniversary push notification to the member celebrating their registration anniversary
   */
  private static async notifyAnniversaryMember(member: Member) {
    if (!member.fcmToken) {
      console.log(
        `[AnniversaryCron] Skipped direct anniversary notification for ${member.fullName} — no FCM token.`
      );
      return;
    }

    const name = (member.businessName || member.fullName).trim();
    const subject = `${name} Anniversary`;
    const content = `Celebrating another successful year of ${name}! Wishing the team continued growth and success. 🎉`;

    await insertPushNotification({
      token: member.fcmToken,
      subject,
      content,
      moduleName: NotificationModule.ANNIVERSARY,
      moduleId: member._id.toString(),
      receiverId: member._id.toString(),
      senderId: member._id.toString()
    });

    console.log(
      `[AnniversaryCron] Direct anniversary notification sent to ${name} (${member._id})`
    );
  }
}
