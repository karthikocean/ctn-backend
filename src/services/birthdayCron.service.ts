import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Connection, ConnectionStatus } from "../entity/Connection";
import { sendPushNotification, insertPushNotification } from "./pushnotification.service";
import { ObjectId } from "mongodb";
import { NotificationModule } from "../entity/PushNotifications";

export class BirthdayCronService {
  private static memberRepo = AppDataSource.getMongoRepository(Member);
  private static connectionRepo = AppDataSource.getMongoRepository(Connection);

  /**
   * Initializes the Birthday cron job — runs every day at 8:00 AM
   */
  static init() {
    console.log("🎂 Initializing Birthday Cron Job...");

    // Runs every day at 8:00 AM
    cron.schedule("0 8 * * *", async () => {
      try {
        console.log("🎂 Running Birthday Cron...");
        await this.processBirthdays();
      } catch (error: any) {
        console.error("❌ Birthday Cron Failed:", error.message);
      }
    });
  }

  /**
   * Finds all members with a birthday today, sends them a direct birthday notification, and notifies their mutual friends
   */
  static async processBirthdays() {
    const now = new Date();
    const todayMonth = now.getMonth() + 1; // 1-based month
    const todayDay = now.getDate();

    console.log(`[BirthdayCron] Checking birthdays for ${todayDay}/${todayMonth}`);

    // Fetch all active members who have a dob set
    const allMembers = await this.memberRepo.find({
      where: { isDeleted: false, dob: { $exists: true, $ne: null } } as any
    });

    // Filter members whose dob day and month match today
    const birthdayMembers = allMembers.filter((member) => {
      if (!member.dob) return false;
      const dob = new Date(member.dob);
      return dob.getDate() === todayDay && dob.getMonth() + 1 === todayMonth;
    });

    if (birthdayMembers.length === 0) {
      console.log("[BirthdayCron] No birthdays today.");
      return;
    }

    console.log(`[BirthdayCron] Found ${birthdayMembers.length} birthday(s) today.`);

    for (const birthdayMember of birthdayMembers) {
      try {
        // 1. Send direct birthday wish push notification to the member
        await this.notifyBirthdayMember(birthdayMember);

        // 2. Notify mutual friends about the member's birthday
        await this.notifyMutualFriends(birthdayMember);
      } catch (err: any) {
        console.error(
          `[BirthdayCron] Failed to process birthday for member ${birthdayMember._id}:`,
          err.message
        );
      }
    }
  }

  /**
   * Sends a birthday wish push notification directly to the birthday member
   */
  private static async notifyBirthdayMember(birthdayMember: Member) {
    if (!birthdayMember.fcmToken) {
      console.log(
        `[BirthdayCron] Skipped direct birthday wish for ${birthdayMember.fullName} — no FCM token.`
      );
      return;
    }

    const subject = "Birthday Wishes";
    const content = `Wishing you a very Happy Birthday, ${birthdayMember.fullName}! Have a wonderful year ahead. 🎉`;

    await sendPushNotification(birthdayMember.fcmToken, subject, {
      content,
      moduleName: NotificationModule.BIRTHDAY,
      moduleId: birthdayMember._id.toString()
    });

    console.log(
      `[BirthdayCron] Direct birthday wish notification sent to ${birthdayMember.fullName} (${birthdayMember._id})`
    );
  }

  /**
   * Finds mutual friends of a birthday member and sends them a push notification
   */
  private static async notifyMutualFriends(birthdayMember: Member) {
    const memberId = birthdayMember._id;

    // People that the birthday member follows
    const following = await this.connectionRepo.find({
      where: { senderId: memberId, status: ConnectionStatus.ACCEPTED } as any
    });

    // People that follow the birthday member
    const followers = await this.connectionRepo.find({
      where: { receiverId: memberId, status: ConnectionStatus.ACCEPTED } as any
    });

    const followingIds = new Set(following.map((f) => f.receiverId.toString()));
    const followerIds = new Set(followers.map((f) => f.senderId.toString()));

    // Mutual friends: those who both follow and are followed by the birthday member
    const mutualIds = [...followingIds].filter((id) => followerIds.has(id));

    if (mutualIds.length === 0) {
      console.log(
        `[BirthdayCron] No mutual friends found for member ${birthdayMember.fullName}.`
      );
      return;
    }

    console.log(
      `[BirthdayCron] Notifying ${mutualIds.length} mutual friend(s) about ${birthdayMember.fullName}'s birthday.`
    );

    const subject = `${birthdayMember.fullName}'s Birthday`;
    const content = `It's ${birthdayMember.fullName}'s birthday! Send your wishes and make her day special. 🎉`;

    for (const mutualId of mutualIds) {
      try {
        const friend = await this.memberRepo.findOneBy({
          _id: new ObjectId(mutualId),
          isDeleted: false
        });

        if (!friend) continue;

        if (friend.fcmToken) {
          await insertPushNotification({
            token: friend.fcmToken,
            subject,
            content,
            moduleName: NotificationModule.BIRTHDAY,
            moduleId: memberId.toString(),
            receiverId: friend._id.toString(),
            senderId: memberId.toString()
          });

          console.log(
            `[BirthdayCron] Push notification sent to ${friend.fullName} (${friend._id})`
          );
        } else {
          console.log(
            `[BirthdayCron] Skipped ${friend.fullName} — no FCM token.`
          );
        }
      } catch (friendErr: any) {
        console.error(
          `[BirthdayCron] Failed to notify mutual friend ${mutualId}:`,
          friendErr.message
        );
      }
    }
  }
}
