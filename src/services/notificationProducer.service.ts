import { personalNotificationQueue, broadcastNotificationQueue } from "../queues/notification.queue";
import { PersonalNotificationJobData } from "../workers/personal.worker";
import { BroadcastInitiateJobData, ActivityGapReminderJobData } from "../workers/broadcast.worker";

export interface QueuePersonalNotificationDto {
  receiverId: string;
  subject: string;
  content: string;
  moduleName?: string;
  moduleId?: string;
  senderId?: string;
  fcmToken?: string;
  name?: string;
  phone?: string;
  email?: string;
}

export interface QueueBroadcastNotificationDto {
  subject: string;
  content: string;
  moduleName?: string;
  moduleId?: string;
  senderId?: string;
  useTopic?: boolean;
  topicName?: string;
}

export interface QueueActivityGapReminderDto {
  activityType: "notPosted" | "notAsked" | "notGiven" | "notRequirements";
  subject: string;
  content: string;
  senderId?: string;
  regionId?: string;
  categoryId?: string;
}

export class NotificationProducerService {
  /**
   * Enqueue a Personal (Type 2) Notification job.
   * API returns immediately in < 5ms while BullMQ handles execution.
   */
  public static async enqueuePersonalNotification(dto: QueuePersonalNotificationDto): Promise<{ jobId: string }> {
    const jobPayload: PersonalNotificationJobData = {
      receiverId: dto.receiverId,
      subject: dto.subject,
      content: dto.content,
      moduleName: dto.moduleName,
      moduleId: dto.moduleId,
      senderId: dto.senderId,
      fcmToken: dto.fcmToken,
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
    };

    const job = await personalNotificationQueue.add("personal-send", jobPayload);
    return { jobId: job.id! };
  }

  /**
   * Enqueue a Broadcast (Type 1) Notification job.
   * Instantly enqueues an orchestrator job that chunks 1,000,000 members via Mongo Cursor.
   */
  public static async enqueueBroadcastNotification(dto: QueueBroadcastNotificationDto): Promise<{ broadcastId: string; jobId: string }> {
    const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const jobPayload: BroadcastInitiateJobData = {
      broadcastId,
      subject: dto.subject,
      content: dto.content,
      moduleName: dto.moduleName,
      moduleId: dto.moduleId,
      senderId: dto.senderId,
      useTopic: dto.useTopic ?? false,
      topicName: dto.topicName,
    };

    const job = await broadcastNotificationQueue.add("broadcast-initiate", jobPayload);
    return { broadcastId, jobId: job.id! };
  }

  /**
   * Helper to queue bulk personal notifications using BullMQ addBulk
   */
  /**
   * Enqueue an Activity Gap Reminder job.
   * API returns immediately in < 5ms while BullMQ streams active members matching the activity gap.
   */
  public static async enqueueActivityGapReminder(dto: QueueActivityGapReminderDto): Promise<{ reminderId: string; jobId: string }> {
    const reminderId = `gap_${dto.activityType}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const jobPayload: ActivityGapReminderJobData = {
      reminderId,
      activityType: dto.activityType,
      subject: dto.subject,
      content: dto.content,
      senderId: dto.senderId,
      regionId: dto.regionId,
      categoryId: dto.categoryId,
    };

    const job = await broadcastNotificationQueue.add("activity-gap-reminder", jobPayload);
    return { reminderId, jobId: job.id! };
  }

  public static async enqueuePersonalBatch(dtos: QueuePersonalNotificationDto[]): Promise<void> {
    if (!dtos || dtos.length === 0) return;

    const jobs = dtos.map((dto) => ({
      name: "personal-send",
      data: {
        receiverId: dto.receiverId,
        subject: dto.subject,
        content: dto.content,
        moduleName: dto.moduleName,
        moduleId: dto.moduleId,
        senderId: dto.senderId,
        fcmToken: dto.fcmToken,
      },
    }));

    await personalNotificationQueue.addBulk(jobs);
  }
}
