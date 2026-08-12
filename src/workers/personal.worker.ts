import { Worker, Job } from "bullmq";
import { ObjectId } from "mongodb";
import { bullRedisConfig } from "../config/bullmq.config";
import { QUEUE_NAMES, dlqNotificationQueue } from "../queues/notification.queue";
import { AppDataSource } from "../data-source";
import { PushNotification } from "../entity/PushNotifications";
import { FcmService } from "../services/fcm.service";
import { SocketNotificationService } from "../services/socketNotification.service";
import { Member } from "../entity/Member";

export interface PersonalNotificationJobData {
  receiverId: string;
  subject: string;
  content: string;
  moduleName?: string;
  moduleId?: string;
  senderId?: string;
  fcmToken?: string;
}

export const personalWorker = new Worker(
  QUEUE_NAMES.PERSONAL,
  async (job: Job<PersonalNotificationJobData>) => {
    const { receiverId, subject, content, moduleName, moduleId, senderId, fcmToken } = job.data;
    if (!receiverId || !ObjectId.isValid(receiverId)) {
      throw new Error(`Invalid receiverId: ${receiverId}`);
    }

    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);
    const receiverOid = new ObjectId(receiverId);

    // 1. Insert notification record into MongoDB
    const now = new Date();
    const notification = new PushNotification();
    notification.sub = subject;
    notification.msg = content;
    notification.moduleName = moduleName as any;
    notification.moduleId = moduleId ? new ObjectId(moduleId) : undefined;
    notification.receiverId = receiverOid;
    notification.senderId = senderId ? new ObjectId(senderId) : undefined;
    notification.isRead = false;
    notification.isDeleted = false;
    notification.createdAt = now;
    notification.updatedAt = now;

    await notificationRepo.save(notification);

    // 2. Emit socket unread count ONLY if target user is online/connected
    await SocketNotificationService.emitUnreadIfConnected(receiverId);

    // 3. Obtain FCM token if not provided in job payload
    let targetToken = fcmToken;
    if (!targetToken) {
      const memberRepo = AppDataSource.getMongoRepository(Member);
      const member = await memberRepo.findOne({
        where: { _id: receiverOid },
        select: { fcmToken: true } as any,
      });
      targetToken = member?.fcmToken;
    }

    // 4. Send FCM Push Notification
    if (targetToken) {
      await FcmService.sendToToken(targetToken, {
        title: subject,
        body: content,
        data: {
          moduleName: moduleName || "",
          moduleId: moduleId || "",
          senderId: senderId || "",
        },
      });
    }
  },
  {
    connection: bullRedisConfig,
    concurrency: 20, // Concurrency for personal worker execution
    skipVersionCheck: true,
  }
);

personalWorker.on("failed", async (job: Job<PersonalNotificationJobData> | undefined, err: Error) => {
  console.error(`❌ [PersonalWorker] Job ${job?.id} failed:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts || 5)) {
    console.error(`💀 [PersonalWorker] Moving job ${job.id} to Dead Letter Queue (DLQ)...`);
    await dlqNotificationQueue.add("personal-dlq", {
      failedJobId: job.id,
      jobName: job.name,
      data: job.data,
      failedReason: err.message,
      stackTrace: err.stack,
      failedAt: new Date().toISOString(),
    });
  }
});
