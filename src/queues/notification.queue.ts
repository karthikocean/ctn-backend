import { Queue, QueueEvents, JobsOptions } from "bullmq";
import { bullRedisConfig } from "../config/bullmq.config";

export const QUEUE_NAMES = {
  PERSONAL: "notification-personal",
  BROADCAST: "notification-broadcast",
  CLEANUP: "notification-cleanup",
  DLQ: "notification-dlq",
} as const;

// Default job options with exponential backoff retries & Stream retention controls
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2000, // 2s, 4s, 8s, 16s, 32s
  },
  removeOnComplete: {
    age: 3600, // Keep completed jobs for 1 hour
    count: 2000,
  },
  removeOnFail: {
    age: 86400 * 3, // Keep failed jobs for 3 days for inspection/DLQ
    count: 10000,
  },
};

// Queue instances
export const personalNotificationQueue = new Queue(QUEUE_NAMES.PERSONAL, {
  connection: bullRedisConfig,
  defaultJobOptions,
});

export const broadcastNotificationQueue = new Queue(QUEUE_NAMES.BROADCAST, {
  connection: bullRedisConfig,
  defaultJobOptions,
});

export const dlqNotificationQueue = new Queue(QUEUE_NAMES.DLQ, {
  connection: bullRedisConfig,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// QueueEvents listeners for monitoring job failures (with Redis stream maxLen configuration)
export const personalQueueEvents = new QueueEvents(
  QUEUE_NAMES.PERSONAL,
  {
    connection: bullRedisConfig,
    streams: {
      events: {
        maxLen: 10000,
      },
    },
  } as any
);

export const broadcastQueueEvents = new QueueEvents(
  QUEUE_NAMES.BROADCAST,
  {
    connection: bullRedisConfig,
    streams: {
      events: {
        maxLen: 10000,
      },
    },
  } as any
);

personalQueueEvents.on("failed", ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
  console.error(`❌ [PersonalQueueEvent] Job ${jobId} failed: ${failedReason}`);
});

broadcastQueueEvents.on("failed", ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
  console.error(`❌ [BroadcastQueueEvent] Job ${jobId} failed: ${failedReason}`);
});
