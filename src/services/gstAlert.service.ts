import { Member } from "../entity/Member";
import { NotificationModule } from "../entity/PushNotifications";
import { insertPushNotification } from "./pushnotification.service";
import { MailService } from "./mail.service";

export interface AttemptedRegistrantInfo {
  fullName?: string;
  mobileNumber?: string;
  email?: string;
}

export class GstAlertService {
  /**
   * In-memory timestamp cache to avoid spamming existing members if verify-gst
   * is called repeatedly within a 60-second window for the same GST number.
   */
  private static recentAlerts = new Map<string, number>();

  /**
   * Notify User 1 when a 2nd user successfully registers with the same GST.
   */
  static async notifySecondUserRegistered(existingMember: Member, newMember: Member) {
    const gstNumber = newMember.gstNumber || "";
    const subject = "New Member Registered with Your GST";
    const content = `${newMember.fullName || "A new user"} (${newMember.mobileNumber}) has registered using your GST number (${gstNumber}).`;

    try {
      await insertPushNotification({
        token: existingMember.fcmToken || "",
        subject,
        content,
        moduleName: NotificationModule.GENERAL,
        receiverId: existingMember._id.toString(),
        name: newMember.fullName,
        phone: newMember.mobileNumber,
        email: newMember.email
      });
    } catch (pushErr: any) {
      console.error(`[GST Alert] Failed to send push notification to member ${existingMember._id}:`, pushErr.message);
    }

    if (existingMember.email) {
      try {
        await MailService.sendGstSecondUserRegistrationEmail(
          { fullName: existingMember.fullName, email: existingMember.email },
          { fullName: newMember.fullName, mobileNumber: newMember.mobileNumber, email: newMember.email },
          gstNumber
        );
      } catch (mailErr: any) {
        console.error(`[GST Alert] Failed to send email alert to ${existingMember.email}:`, mailErr.message);
      }
    }
  }

  /**
   * Notify all existing members when a 3rd user attempts to register or verify with their GST.
   */
  static async notifySuspiciousAttempt(
    existingMembers: Member[],
    gstNumber: string,
    attemptedUser?: AttemptedRegistrantInfo
  ) {
    const cleanGst = gstNumber.trim().toUpperCase();
    const now = Date.now();
    const lastSent = this.recentAlerts.get(cleanGst) || 0;
    // Debounce: If an alert was sent for this GST in the last 60 seconds, skip duplicate notifications
    if (now - lastSent < 60000) {
      console.log(`[GST Security Alert] Alert for GST ${cleanGst} debounced (sent ${Math.round((now - lastSent) / 1000)}s ago).`);
      return;
    }
    this.recentAlerts.set(cleanGst, now);

    const personInfo = attemptedUser?.mobileNumber
      ? `Person: ${attemptedUser.fullName || "Unknown"} (${attemptedUser.mobileNumber})`
      : "An unauthorized user";
    const subject = "⚠️ Security Alert: Unauthorized GST Registration Attempt";
    const content = `A suspicious attempt to register using your GST (${cleanGst}) was blocked. ${personInfo}.`;

    for (const member of existingMembers) {
      try {
        await insertPushNotification({
          token: member.fcmToken || "",
          subject,
          content,
          moduleName: NotificationModule.GENERAL,
          receiverId: member._id.toString(),
          name: attemptedUser?.fullName,
          phone: attemptedUser?.mobileNumber,
          email: attemptedUser?.email
        });
      } catch (pushErr: any) {
        console.error(`[GST Suspicious Alert] Failed push notification to member ${member._id}:`, pushErr.message);
      }

      if (member.email) {
        try {
          await MailService.sendGstSuspiciousAttemptEmail(
            { fullName: member.fullName, email: member.email },
            {
              fullName: attemptedUser?.fullName,
              mobileNumber: attemptedUser?.mobileNumber || "Not provided (Attempted via verification)",
              email: attemptedUser?.email
            },
            cleanGst
          );
        } catch (mailErr: any) {
          console.error(`[GST Suspicious Alert] Failed email to ${member.email}:`, mailErr.message);
        }
      }
    }
  }
}
