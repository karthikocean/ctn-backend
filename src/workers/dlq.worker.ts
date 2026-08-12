import { Worker, Job } from "bullmq";
import { bullRedisConfig } from "../config/bullmq.config";
import { QUEUE_NAMES } from "../queues/notification.queue";

export interface DlqJobPayload {
  failedJobId?: string;
  jobName: string;
  data: any;
  failedReason: string;
  stackTrace?: string;
  failedAt: string;
}

export const dlqWorker = new Worker(
  QUEUE_NAMES.DLQ,
  async (job: Job<DlqJobPayload>) => {
    const { failedJobId, jobName, data, failedReason, failedAt } = job.data;
    console.error("🚨 [DLQ Worker] Processing permanently failed job:", {
      dlqJobId: job.id,
      failedJobId,
      jobName,
      failedReason,
      failedAt,
      receiverId: data?.receiverId || data?.members?.length,
    });

    // Here you can persist the DLQ record into a MongoDB collection or send an alert email/Slack webhook
  },
  {
    connection: bullRedisConfig,
    concurrency: 5,
    skipVersionCheck: true,
  }
);

dlqWorker.on("completed", (job: Job) => {
  console.log(`✅ [DLQ Worker] Logged failed job ${job.id}`);
});
