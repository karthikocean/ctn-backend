import { AppDataSource } from "../data-source";
import { OneToOne } from "../entity/OneToOne";
import { Referral } from "../entity/Referral";
import { ThankYouSlip } from "../entity/ThankYouSlip";
import { Member } from "../entity/Member";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "routing-controllers";
import { insertPushNotification } from "./pushnotification.service";
import { NotificationModule } from "../entity/PushNotifications";

export interface UpdateStatusOptions {
  id: string;
  status: string;
  reason?: string;
  type?: string;
  currentUserId?: string; // Optional: If initiated by a authenticated mobile member
}

export class SlipService {
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private tySlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  async updateStatus(options: UpdateStatusOptions) {
    const { id, status, reason, type, currentUserId } = options;

    if (!id || !ObjectId.isValid(id)) {
      throw new BadRequestError("Valid slip ID is required");
    }

    if (!status || typeof status !== "string" || !status.trim()) {
      throw new BadRequestError("Status is required");
    }

    const objId = new ObjectId(id);
    let updatedRecord: any = null;
    let detectedType: string = "";
    let senderId: ObjectId | null = null;
    let receiverId: ObjectId | null = null;

    const normalizedType = type ? type.trim().toUpperCase().replace(/-/g, "_") : "";

    // 1. If explicit type is provided
    if (normalizedType === "ONE_TO_ONE" || normalizedType === "121") {
      const record = await this.oneToOneRepo.findOneBy({ _id: objId });
      if (record) {
        record.status = status.trim();
        if (reason !== undefined) record.reason = reason;
        updatedRecord = await this.oneToOneRepo.save(record);
        detectedType = "ONE_TO_ONE";
        senderId = record.senderId;
        receiverId = record.receiverId;
      }
    } else if (normalizedType === "REFERRAL") {
      const record = await this.referralRepo.findOneBy({ _id: objId });
      if (record) {
        record.status = status.trim() as any;
        if (reason !== undefined) record.reason = reason;
        updatedRecord = await this.referralRepo.save(record);
        detectedType = "REFERRAL";
        senderId = record.senderId;
        receiverId = record.receiverId;
      }
    } else if (
      normalizedType === "THANK_YOU_SLIP" ||
      normalizedType === "THANKYOUSLIP" ||
      normalizedType === "TY_SLIP"
    ) {
      const record = await this.tySlipRepo.findOneBy({ _id: objId });
      if (record) {
        record.status = status.trim();
        if (reason !== undefined) record.reason = reason;
        updatedRecord = await this.tySlipRepo.save(record);
        detectedType = "THANK_YOU_SLIP";
        senderId = record.senderId;
        receiverId = record.receiverId;
      }
    }

    // 2. Auto-detect if not found by explicit type (or type wasn't provided)
    if (!updatedRecord) {
      // Try 121 (OneToOne)
      const oto = await this.oneToOneRepo.findOneBy({ _id: objId });
      if (oto) {
        oto.status = status.trim();
        if (reason !== undefined) oto.reason = reason;
        updatedRecord = await this.oneToOneRepo.save(oto);
        detectedType = "ONE_TO_ONE";
        senderId = oto.senderId;
        receiverId = oto.receiverId;
      } else {
        // Try Referral
        const ref = await this.referralRepo.findOneBy({ _id: objId });
        if (ref) {
          ref.status = status.trim() as any;
          if (reason !== undefined) ref.reason = reason;
          updatedRecord = await this.referralRepo.save(ref);
          detectedType = "REFERRAL";
          senderId = ref.senderId;
          receiverId = ref.receiverId;
        } else {
          // Try ThankYouSlip
          const ty = await this.tySlipRepo.findOneBy({ _id: objId });
          if (ty) {
            ty.status = status.trim();
            if (reason !== undefined) ty.reason = reason;
            updatedRecord = await this.tySlipRepo.save(ty);
            detectedType = "THANK_YOU_SLIP";
            senderId = ty.senderId;
            receiverId = ty.receiverId;
          }
        }
      }
    }

    if (!updatedRecord) {
      throw new NotFoundError("Slip record (121, Referral, or Thank You Slip) not found");
    }

    // Push notification logic if triggered by a user
    if (currentUserId && (senderId || receiverId)) {
      try {
        const isSender = senderId?.toString() === currentUserId;
        const targetMemberId = isSender ? receiverId : senderId;

        if (targetMemberId && ObjectId.isValid(targetMemberId)) {
          const targetMember = await this.memberRepo.findOneBy({ _id: targetMemberId, isDeleted: false });
          const currentMember = await this.memberRepo.findOneBy({
            _id: new ObjectId(currentUserId),
            isDeleted: false
          });

          if (targetMember?.fcmToken) {
            let notificationModule = NotificationModule.MESSAGE;
            let displayType = "Slip";

            if (detectedType === "ONE_TO_ONE") {
              notificationModule = NotificationModule.ONE_TO_ONE;
              displayType = "1-to-1 Slip";
            } else if (detectedType === "REFERRAL") {
              notificationModule = NotificationModule.REFERRAL;
              displayType = "Referral";
            } else if (detectedType === "THANK_YOU_SLIP") {
              notificationModule = NotificationModule.THANK_YOU_SLIP;
              displayType = "Thank You Slip";
            }

            const senderName = currentMember?.fullName || "A member";
            const reasonSuffix = reason ? ` (Reason: ${reason})` : "";

            await insertPushNotification({
              token: targetMember.fcmToken,
              subject: `${displayType} Status Updated`,
              content: `${senderName} updated status of ${displayType} to '${status}'${reasonSuffix}.`,
              moduleName: notificationModule,
              moduleId: updatedRecord._id.toString(),
              receiverId: targetMemberId.toString(),
              senderId: currentUserId
            });
          }
        }
      } catch (notifyErr) {
        console.error("Failed to send push notification on slip status update:", notifyErr);
      }
    }

    return {
      type: detectedType,
      record: updatedRecord
    };
  }
}
