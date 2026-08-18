import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Reminder, ReminderStatus, RepeatType, NotifyBy } from "../entity/Reminder";
import { Member } from "../entity/Member";
import { insertPushNotification } from "./pushnotification.service";
import { MailService } from "./mail.service";

export class ReminderCronService {
  private static reminderRepo = AppDataSource.getMongoRepository(Reminder);
  private static memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * Initializes the Reminder cron job to run every minute
   */
  static init() {
    console.log("⏰ Initializing Reminder Cron Job...");

    cron.schedule("* * * * *", async () => {
      try {
        console.log("🕒 Running Reminder Cron...");
        await this.processDueReminders();
      } catch (error: any) {
        console.error("❌ Reminder Cron Failed:", error.message);
      }
    });
  }

  /**
   * Processes all active pending reminders that are due
   */
  static async processDueReminders() {
    const now = new Date();

    // Query active, pending reminders where nextReminderDate is due
    const dueReminders = await this.reminderRepo.find({
      where: {
        isDeleted: false,
        isActive: true,
        status: ReminderStatus.PENDING,
        nextReminderDate: { $lte: now }
      } as any
    });

    if (dueReminders.length === 0) {
      console.log("⏭️  Reminder Cron: No due reminders to process.");
      return;
    }

    console.log(`[ReminderCron] Found ${dueReminders.length} due reminder(s) to trigger.`);

    for (const reminder of dueReminders) {
      try {
        await this.triggerReminder(reminder, now);
      } catch (err: any) {
        console.error(`[ReminderCron] Failed to process reminder ${reminder._id}:`, err.message);
      }
    }
  }

  /**
   * Triggers a specific reminder, sending notifications to all recipients and updating reminder state
   */
  private static async triggerReminder(reminder: Reminder, triggerTime: Date) {
    console.log(`[ReminderCron] Triggering reminder: "${reminder.title}" (ID: ${reminder._id})`);

    const recipients = reminder.recipients || [];

    for (const recipientId of recipients) {
      try {
        const member = await this.memberRepo.findOneBy({ _id: recipientId, isDeleted: false });
        if (!member) {
          console.warn(`[ReminderCron] Recipient member not found: ${recipientId}`);
          continue;
        }

        const subject = reminder.title;
        const content = reminder.description || `This is a scheduled reminder for your ${reminder.title}`;

        const notifyByList: string[] = Array.isArray(reminder.notifyBy)
          ? (reminder.notifyBy as string[])
          : (typeof reminder.notifyBy === "string" ? [reminder.notifyBy] : []);

        // 1. Email Notification
        if (notifyByList.includes(NotifyBy.EMAIL) && member.email) {
          console.log(`[ReminderCron] Sending Email to ${member.email}`);
          await MailService.sendEmail(
            member.email,
            subject,
            `<p>Dear ${member.fullName},</p><p><strong>${reminder.title}</strong></p><p>${content}</p><p>Best regards,<br>Trusted Network Team</p>`
          );
        }

        // 2. Push Notification
        const hasPush = notifyByList.includes(NotifyBy.PUSH) || notifyByList.includes(NotifyBy.APP);
        if (hasPush && member.fcmToken) {
          console.log(`[ReminderCron] Sending Push Notification to member ${member.fullName}`);

          await insertPushNotification({
            token: member.fcmToken,
            subject: subject,
            content: content,
            moduleName: "REMINDER",
            moduleId: reminder.conversationId.toString(),
            receiverId: member._id.toString()
          });
        }

        // 3. Other notification channels (SMS / WhatsApp / APP) placeholder log
        if (notifyByList.includes(NotifyBy.SMS)) {
          console.log(`[ReminderCron] [SMS Simulation] Sending SMS to ${member.fullName} (${member.mobileNumber || "No Phone"}): ${content}`);
        }
        if (notifyByList.includes(NotifyBy.WHATSAPP)) {
          console.log(`[ReminderCron] [WhatsApp Simulation] Sending WhatsApp to ${member.fullName} (${member.mobileNumber || "No Phone"}): ${content}`);
        }

      } catch (recipientErr: any) {
        console.error(`[ReminderCron] Failed to send notification to recipient ${recipientId}:`, recipientErr.message);
      }
    }

    // Update reminder state
    reminder.lastTriggeredAt = triggerTime;

    if (reminder.repeatType === RepeatType.ONCE || !reminder.repeatType) {
      reminder.status = ReminderStatus.COMPLETED;
      reminder.isActive = false; // Mark inactive since it ran once
      console.log(`[ReminderCron] Reminder ${reminder._id} marked as COMPLETED (Once).`);
    } else {
      // Calculate next trigger date
      let nextDate = this.calculateNextReminderDate(reminder.nextReminderDate, reminder.repeatType, reminder.repeatInterval);
      let safetyCount = 0;
      while (nextDate <= triggerTime) {
        const prevTime = nextDate.getTime();
        nextDate = this.calculateNextReminderDate(nextDate, reminder.repeatType, reminder.repeatInterval);

        // If the date does not advance (e.g. interval is 0 or repeatType is invalid), break to avoid infinite loop
        if (nextDate.getTime() <= prevTime || ++safetyCount > 1000) {
          console.warn(`[ReminderCron] Date did not advance for reminder ${reminder._id}. Breaking to prevent infinite loop.`);
          nextDate = new Date(triggerTime.getTime() + 24 * 60 * 60 * 1000); // Fallback to tomorrow
          break;
        }
      }
      reminder.nextReminderDate = nextDate;
      console.log(`[ReminderCron] Reminder ${reminder._id} scheduled next run for: ${reminder.nextReminderDate.toISOString()}`);
    }

    await this.reminderRepo.save(reminder);
  }

  private static calculateNextReminderDate(currentNext: Date, repeatType: RepeatType, interval: number): Date {
    const next = new Date(currentNext);
    switch (repeatType) {
    case RepeatType.DAILY:
      next.setDate(next.getDate() + interval);
      break;
    case RepeatType.WEEKLY:
      next.setDate(next.getDate() + 7 * interval);
      break;
    case RepeatType.MONTHLY:
      next.setMonth(next.getMonth() + interval);
      break;
    case RepeatType.YEARLY:
      next.setFullYear(next.getFullYear() + interval);
      break;
    default:
      break;
    }
    return next;
  }

}
