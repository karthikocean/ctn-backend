import { Worker, Job } from "bullmq";
import { ObjectId } from "mongodb";
import { redisConfig } from "../config/redis.config";
import { QUEUE_NAMES, broadcastNotificationQueue, dlqNotificationQueue } from "../queues/notification.queue";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { PushNotification } from "../entity/PushNotifications";
import { FcmService } from "../services/fcm.service";
import { SocketNotificationService } from "../services/socketNotification.service";

export interface BroadcastInitiateJobData {
  broadcastId: string;
  subject: string;
  content: string;
  moduleName?: string;
  moduleId?: string;
  senderId?: string;
  useTopic?: boolean;
  topicName?: string;
}

export interface BroadcastChunkJobData {
  broadcastId: string;
  subject: string;
  content: string;
  moduleName?: string;
  moduleId?: string;
  senderId?: string;
  members: Array<{ id: string; fcmToken?: string }>;
  useTopic?: boolean;
}

const CHUNK_SIZE = 2000; // Process 2,000 members per worker job to optimize RAM & Redis
const BULK_ENQUEUE_SIZE = 50; // Batch add 50 chunk jobs to Redis at once

/**
 * Worker for processing Broadcast Notifications
 */
export const broadcastWorker = new Worker(
  QUEUE_NAMES.BROADCAST,
  async (job: Job) => {
    switch (job.name) {
    case "broadcast-initiate":
      await handleBroadcastInitiate(job);
      break;
    case "broadcast-chunk":
      await handleBroadcastChunk(job);
      break;
    default:
      console.warn(`⚠️ [BroadcastWorker] Unknown job name: ${job.name}`);
    }
  },
  {
    connection: redisConfig,
    concurrency: 10, // Adjust worker concurrency per CPU core
    limiter: {
      max: 100,
      duration: 1000, // Max 100 jobs processed per second per worker instance
    },
  }
);

/**
 * Orchestrator Handler: Streams active members via Mongo Cursor in chunks of 2,000
 * and enqueues bulk jobs to Redis without loading 1M records into memory.
 */
async function handleBroadcastInitiate(job: Job<BroadcastInitiateJobData>): Promise<void> {
  const { broadcastId, subject, content, moduleName, moduleId, senderId, useTopic, topicName } = job.data;
  console.log(`🚀 [Broadcast Orchestrator] Starting broadcast initiation ${broadcastId}...`);

  // If FCM Topic is enabled, broadcast payload once to topic
  if (useTopic) {
    const targetTopic = topicName || "all_members";
    console.log(`📢 [Broadcast Orchestrator] Dispatching topic push notification to /topics/${targetTopic}`);
    await FcmService.sendToTopic(targetTopic, {
      title: subject,
      body: content,
      data: { moduleName: moduleName || "", moduleId: moduleId || "" },
    });
  }

  const memberRepo = AppDataSource.getMongoRepository(Member);

  // Use MongoDB Cursor for 1M records (projecting only _id and fcmToken to save RAM)
  const mongoCursor = memberRepo.createCursor({
    status: MemberStatus.ACTIVE,
    isDeleted: false,
  } as any).project({ _id: 1, fcmToken: 1 });

  let memberBuffer: Array<{ id: string; fcmToken?: string }> = [];
  let chunkJobsBuffer: Array<{
    name: string;
    data: BroadcastChunkJobData;
    opts: { attempts: number; backoff: any };
  }> = [];

  let totalMembersQueued = 0;
  let totalChunksEnqueued = 0;

  while (await mongoCursor.hasNext()) {
    const memberDoc = await mongoCursor.next();
    if (!memberDoc) break;

    memberBuffer.push({
      id: memberDoc._id.toString(),
      fcmToken: memberDoc.fcmToken,
    });

    // When buffer reaches 2,000 records, create chunk job object
    if (memberBuffer.length >= CHUNK_SIZE) {
      totalMembersQueued += memberBuffer.length;
      totalChunksEnqueued++;

      chunkJobsBuffer.push({
        name: "broadcast-chunk",
        data: {
          broadcastId,
          subject,
          content,
          moduleName,
          moduleId,
          senderId,
          members: memberBuffer,
          useTopic,
        },
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
        },
      });

      memberBuffer = []; // Reset buffer

      // Batch enqueue chunk jobs to Redis when buffer reaches 50 chunks (100k members)
      if (chunkJobsBuffer.length >= BULK_ENQUEUE_SIZE) {
        await broadcastNotificationQueue.addBulk(chunkJobsBuffer as any);
        chunkJobsBuffer = [];
        console.log(`📦 [Broadcast Orchestrator] Enqueued ${totalChunksEnqueued} chunks (${totalMembersQueued} members total)...`);
      }
    }
  }

  // Handle remaining members in buffer
  if (memberBuffer.length > 0) {
    totalMembersQueued += memberBuffer.length;
    totalChunksEnqueued++;

    chunkJobsBuffer.push({
      name: "broadcast-chunk",
      data: {
        broadcastId,
        subject,
        content,
        moduleName,
        moduleId,
        senderId,
        members: memberBuffer,
        useTopic,
      },
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
  }

  // Flush remaining chunk jobs to Redis
  if (chunkJobsBuffer.length > 0) {
    await broadcastNotificationQueue.addBulk(chunkJobsBuffer as any);
  }

  console.log(`✅ [Broadcast Orchestrator] Finished orchestrating broadcast ${broadcastId}: ${totalMembersQueued} members across ${totalChunksEnqueued} chunk jobs.`);
}

/**
 * Chunk Handler: Processes a single batch of 2,000 members.
 * Performs 1 insertMany DB call, batched FCM push, and online-only Socket emissions.
 */
async function handleBroadcastChunk(job: Job<BroadcastChunkJobData>): Promise<void> {
  const { subject, content, moduleName, moduleId, senderId, members, useTopic } = job.data;
  if (!members || members.length === 0) return;

  const notificationRepo = AppDataSource.getMongoRepository(PushNotification);

  // 1. Prepare MongoDB documents for single batch insertMany (2,000 records)
  const now = new Date();
  const notifications = members.map((member: { id: string; fcmToken?: string }) => ({
    sub: subject,
    msg: content,
    moduleName,
    moduleId: moduleId ? new ObjectId(moduleId) : undefined,
    receiverId: new ObjectId(member.id),
    senderId: senderId ? new ObjectId(senderId) : undefined,
    isRead: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  }));

  // 2. Perform Single Batch Insert into MongoDB
  await notificationRepo.insertMany(notifications, { ordered: false });

  // 3. Send FCM Push Notifications if not using Topic broadcast
  if (!useTopic) {
    const tokens = members.map((m: { id: string; fcmToken?: string }) => m.fcmToken).filter((token: string | undefined): token is string => !!token);
    if (tokens.length > 0) {
      await FcmService.sendBatchTokens(
        tokens,
        {
          title: subject,
          body: content,
          data: { moduleName: moduleName || "", moduleId: moduleId || "" },
        },
        50 // 50 concurrent FCM requests per batch
      );
    }
  }

  // 4. Emit Socket Unread Count ONLY to currently online members in this chunk
  const memberIds = members.map((m: { id: string; fcmToken?: string }) => m.id);
  await SocketNotificationService.emitUnreadToConnectedBatch(memberIds);
}

// Error & DLQ routing
broadcastWorker.on("failed", async (job: Job | undefined, err: Error) => {
  console.error(`❌ [BroadcastWorker] Job ${job?.id} failed:`, err.message);
  // Route to Dead Letter Queue if all 5 retry attempts exhausted
  if (job && job.attemptsMade >= (job.opts.attempts || 5)) {
    console.error(`💀 [BroadcastWorker] Moving job ${job.id} to Dead Letter Queue (DLQ)...`);
    await dlqNotificationQueue.add("broadcast-dlq", {
      failedJobId: job.id,
      jobName: job.name,
      data: job.data,
      failedReason: err.message,
      stackTrace: err.stack,
      failedAt: new Date().toISOString(),
    });
  }
});
