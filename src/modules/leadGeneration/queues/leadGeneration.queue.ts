import { Queue, JobsOptions } from "bullmq";
import { bullRedisConfig } from "../../../config/bullmq.config";
import { LeadGenerationJobData } from "../types/leadGeneration.types";
import { logger } from "../../../utils/logger";

export const LEAD_GENERATION_QUEUE_NAME = "lead-generation";

export const leadGenerationJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000 // 2s, 4s, 8s
  },
  removeOnComplete: {
    age: 3600 * 24, // Keep completed jobs for 24 hours
    count: 1000
  },
  removeOnFail: {
    age: 86400 * 3, // Keep failed jobs for 3 days
    count: 5000
  }
};

export const leadGenerationQueue = new Queue<LeadGenerationJobData>(
  LEAD_GENERATION_QUEUE_NAME,
  {
    connection: bullRedisConfig,
    defaultJobOptions: leadGenerationJobOptions,
    skipVersionCheck: true
  }
);

export async function addLeadGenerationJob(data: LeadGenerationJobData): Promise<string> {
  const job = await leadGenerationQueue.add("generate-leads", data, {
    jobId: `leadgen-${data.generationId}`
  });
  logger.info(`Lead generation job queued: ${job.id} for request ${data.generationId}`);
  return job.id!;
}
