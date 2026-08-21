import { AppDataSource } from "../data-source";
import { OneToOne } from "../entity/OneToOne";
import { Referral } from "../entity/Referral";
import { ThankYouSlip } from "../entity/ThankYouSlip";
import { Member } from "../entity/Member";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "routing-controllers";
import { insertPushNotification } from "./pushnotification.service";
import { NotificationModule } from "../entity/PushNotifications";
import { Contact } from "../entity/Contact";

export interface UpdateStatusOptions {
  id: string;
  status: string;
  reason?: string;
  type?: string;
  currentUserId?: string; // Optional: If initiated by a authenticated mobile member
}

type SlipType = "DIRECT_MEET" | "RECOMMENDATIONS" | "BUSINESS_DONE";

const TYPE_ALIAS_MAP: Record<string, SlipType> = {
  "DIRECT_MEET": "DIRECT_MEET",
  "RECOMMENDATIONS": "RECOMMENDATIONS",
  "BUSINESS_DONE": "BUSINESS_DONE",
};

const ALL_SLIP_TYPES: SlipType[] = ["DIRECT_MEET", "RECOMMENDATIONS", "BUSINESS_DONE"];

export class SlipService {
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private tySlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private contactRepo = AppDataSource.getMongoRepository(Contact);

  async updateStatus(options: UpdateStatusOptions) {
    const { id, status, reason, type, currentUserId } = options;

    if (!id || !ObjectId.isValid(id)) {
      throw new BadRequestError("Valid slip ID is required");
    }

    if (!status || typeof status !== "string" || !status.trim()) {
      throw new BadRequestError("Status is required");
    }

    const trimmedStatus = status.trim();
    const objId = new ObjectId(id);

    // 1. Determine search order based on requested type (if any)
    const normalizedInputType = type ? type.trim().toUpperCase().replace(/-/g, "_") : "";
    const primaryType = TYPE_ALIAS_MAP[normalizedInputType];

    const searchTypes: SlipType[] = primaryType
      ? [primaryType, ...ALL_SLIP_TYPES.filter(t => t !== primaryType)]
      : ALL_SLIP_TYPES;

    let updatedResult: {
      type: SlipType;
      record: any;
      senderId?: ObjectId;
      receiverId?: ObjectId;
    } | null = null;

    // 2. Search repositories sequentially and stop immediately on first match
    for (const slipType of searchTypes) {
      const result = await this.updateSlipRecord(slipType, objId, trimmedStatus, reason);
      if (result) {
        updatedResult = result;
        break;
      }
    }

    if (!updatedResult) {
      throw new NotFoundError("Slip record (Direct Meet, Recommendations, or Business Done) not found");
    }

    const { type: detectedType, record: updatedRecord, senderId, receiverId } = updatedResult;

    // 3. Send push notification if initiated by a member
    if (currentUserId && (senderId || receiverId)) {
      await this.sendNotificationOnStatusUpdate({
        currentUserId,
        senderId,
        receiverId,
        detectedType,
        status: trimmedStatus,
        reason,
        moduleId: updatedRecord.conversationId?.toString()
      });
    }

    return {
      type: detectedType,
      record: updatedRecord
    };
  }

  private async updateSlipRecord(
    slipType: SlipType,
    objId: ObjectId,
    status: string,
    reason?: string
  ) {
    if (slipType === "DIRECT_MEET") {
      const record = await this.oneToOneRepo.findOneBy({ _id: objId });
      if (!record) return null;
      record.status = status;
      if (reason !== undefined) record.reason = reason;
      const updatedRecord = await this.oneToOneRepo.save(record);
      return { type: slipType, record: updatedRecord, senderId: record.senderId, receiverId: record.receiverId };
    }

    if (slipType === "RECOMMENDATIONS") {
      const record = await this.referralRepo.findOneBy({ _id: objId });
      if (!record) return null;
      record.status = status as any;
      if (reason !== undefined) record.reason = reason;
      const updatedRecord = await this.referralRepo.save(record);

      if (record.referralMobile && record.receiverId) {
        const contactData = await this.contactRepo.findOneBy({
          phoneNumber: record.referralMobile,
          referredBy: record.receiverId
        });
        if (contactData) {
          contactData.status = status as any;
          await this.contactRepo.save(contactData);
        }
      }
      return { type: slipType, record: updatedRecord, senderId: record.senderId, receiverId: record.receiverId };
    }

    if (slipType === "BUSINESS_DONE") {
      const record = await this.tySlipRepo.findOneBy({ _id: objId });
      if (!record) return null;
      record.status = status;
      if (reason !== undefined) record.reason = reason;
      const updatedRecord = await this.tySlipRepo.save(record);
      return { type: slipType, record: updatedRecord, senderId: record.senderId, receiverId: record.receiverId };
    }

    return null;
  }

  private async sendNotificationOnStatusUpdate(params: {
    currentUserId: string;
    senderId?: ObjectId;
    receiverId?: ObjectId;
    detectedType: SlipType;
    status: string;
    reason?: string;
    moduleId: string;
  }) {
    try {
      const { currentUserId, senderId, receiverId, detectedType, status, reason, moduleId } = params;
      if (status === 'REPORTED') {
        return;
      }
      const isSender = senderId?.toString() === currentUserId;
      const targetMemberId = isSender ? receiverId : senderId;

      if (!targetMemberId || !ObjectId.isValid(targetMemberId)) return;

      // Parallelize fetching target member and current member from database
      const [targetMember, currentMember] = await Promise.all([
        this.memberRepo.findOneBy({ _id: targetMemberId, isDeleted: false }),
        this.memberRepo.findOneBy({ _id: new ObjectId(currentUserId), isDeleted: false })
      ]);

      if (targetMember?.fcmToken) {
        const senderName = currentMember?.fullName ? currentMember.fullName.trim() : "A member";
        const formattedStatus = status
          .replace(/_/g, " ")
          .trim()
          .split(/\s+/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(" ");
        const reasonSuffix = reason ? ` (Reason: ${reason})` : "";

        let subject = "Status Updated";
        let content = `${senderName} updated status to "${formattedStatus}"${reasonSuffix}.`;
        let moduleName = NotificationModule.GENERAL;

        if (detectedType === "RECOMMENDATIONS") {
          moduleName = NotificationModule.RECOMMENDATIONS;
          subject = "Recommendations Status Updated";
          content = `${senderName} updated the recommendations status to "${formattedStatus}"${reasonSuffix}.`;
        } else if (detectedType === "DIRECT_MEET") {
          moduleName = NotificationModule.DIRECT_MEET;
          subject = "Direct Meet Status Updated";
          content = `${senderName} updated the direct meet status to "${formattedStatus}"${reasonSuffix}.`;
        } else if (detectedType === "BUSINESS_DONE") {
          moduleName = NotificationModule.BUSINESS_DONE;
          subject = "Business Done Status Updated";
          content = `${senderName} updated the business done status to "${formattedStatus}"${reasonSuffix}.`;
        }

        await insertPushNotification({
          token: targetMember.fcmToken,
          subject,
          content,
          moduleName,
          moduleId,
          receiverId: targetMemberId.toString(),
          senderId: currentUserId
        });
      }
    } catch (notifyErr) {
      console.error("Failed to send push notification on slip status update:", notifyErr);
    }
  }
}
