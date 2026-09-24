import { Worker, Job } from "bullmq";
import { ObjectId } from "mongodb";
import { bullRedisConfig } from "../../../config/bullmq.config";
import { LEAD_GENERATION_QUEUE_NAME } from "../queues/leadGeneration.queue";
import { LeadGenerationJobData } from "../types/leadGeneration.types";
import { AppDataSource } from "../../../data-source";
import { LeadGenerationRequest, LeadGenerationStatus } from "../../../entity/LeadGenerationRequest";
import { GeneratedLead } from "../../../entity/GeneratedLead";
import { AIProviderFactory } from "../providers/aiProvider.factory";
import { LeadNormalizationService } from "../services/leadNormalization.service";
import { logger } from "../../../utils/logger";

export const leadGenerationWorker = new Worker<LeadGenerationJobData>(
  LEAD_GENERATION_QUEUE_NAME,
  async (job: Job<LeadGenerationJobData>) => {
    const { generationId, userId, promptOverride } = job.data;
    logger.info(`[LeadGenWorker] Processing job ${job.id} for request ${generationId}`);

    if (!generationId || !ObjectId.isValid(generationId)) {
      throw new Error(`Invalid generationId: ${generationId}`);
    }

    const requestRepo = AppDataSource.getMongoRepository(LeadGenerationRequest);
    const leadsRepo = AppDataSource.getMongoRepository(GeneratedLead);

    const oid = new ObjectId(generationId);
    const leadReq = await requestRepo.findOneBy({ _id: oid as any });

    if (!leadReq) {
      logger.error(`[LeadGenWorker] Request not found for id: ${generationId}`);
      return;
    }

    // 1. Transition status to PROCESSING
    leadReq.status = LeadGenerationStatus.PROCESSING;
    if (promptOverride && promptOverride.trim()) {
      leadReq.generatedPrompt = promptOverride.trim();
    }
    leadReq.updatedAt = new Date();
    await requestRepo.save(leadReq);

    try {
      // 2. Select AI Provider and invoke
      const provider = AIProviderFactory.getProvider(leadReq.provider);
      const aiResponse = await provider.generateLeads(leadReq.generatedPrompt, leadReq.model);

      // 3. Normalize & Deduplicate (cap at 5 leads per request)
      const normalizedLeads = LeadNormalizationService.deduplicateLeads(aiResponse.parsedLeads).slice(0, 5);

      // 4. Save Leads to MongoDB
      const leadEntities: GeneratedLead[] = [];
      const now = new Date();

      for (const item of normalizedLeads) {
        const lead = new GeneratedLead();
        lead.generationId = generationId;
        lead.userId = userId;
        lead.businessName = item.businessName;
        lead.normalizedBusinessName = item.normalizedBusinessName;
        lead.category = item.category;
        lead.locations = item.locations;
        lead.phone = item.phone;
        lead.email = item.email;
        lead.website = item.website;
        lead.normalizedWebsite = item.normalizedWebsite;
        lead.description = item.description;
        lead.confidenceScore = item.confidenceScore;
        lead.isDeleted = false;
        lead.createdAt = now;
        lead.updatedAt = now;
        leadEntities.push(lead);
      }

      if (leadEntities.length > 0) {
        await leadsRepo.save(leadEntities);
      }

      // 5. Update Request document as COMPLETED
      leadReq.status = LeadGenerationStatus.COMPLETED;
      leadReq.rawAIResponse = aiResponse.rawResponse;
      leadReq.rawAIText = aiResponse.rawText;
      leadReq.leadCount = leadEntities.length;
      leadReq.errorMessage = undefined;
      leadReq.metadata = {
        usage: aiResponse.usage,
        latencyMs: aiResponse.latencyMs,
        provider: aiResponse.provider,
        model: aiResponse.model
      };
      leadReq.updatedAt = new Date();
      await requestRepo.save(leadReq);

      logger.info(
        `[LeadGenWorker] Job ${job.id} completed successfully with ${leadEntities.length} leads`
      );
    } catch (err: any) {
      logger.error(`[LeadGenWorker] Job ${job.id} error: ${err.message}`, { stack: err.stack });

      // If attempts will be exhausted or non-retryable error, mark as FAILED
      const isLastAttempt = job.attemptsMade >= (job.opts.attempts || 3) - 1;
      if (isLastAttempt) {
        leadReq.status = LeadGenerationStatus.FAILED;
        leadReq.errorMessage = err.message || "Failed to generate leads";
        leadReq.updatedAt = new Date();
        await requestRepo.save(leadReq);
      }

      throw err; // Trigger BullMQ retry mechanism
    }
  },
  {
    connection: bullRedisConfig,
    concurrency: 5,
    skipVersionCheck: true
  }
);

leadGenerationWorker.on("failed", async (job: Job<LeadGenerationJobData> | undefined, err: Error) => {
  logger.error(`❌ [LeadGenWorker] Job ${job?.id} failed attempt ${job?.attemptsMade}: ${err.message}`);
});
