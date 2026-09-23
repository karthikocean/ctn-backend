import { ObjectId } from "mongodb";
import { AppDataSource } from "../../../data-source";
import { LeadGenerationRequest, LeadGenerationStatus } from "../../../entity/LeadGenerationRequest";
import { GeneratedLead } from "../../../entity/GeneratedLead";
import { CreateLeadGenerationDTO, UpdatePromptDTO } from "../types/leadGeneration.types";
import { LeadValidationService } from "./leadValidation.service";
import { PromptBuilderService } from "./promptBuilder.service";
import { LeadGenerationLimitService } from "./leadGenerationLimit.service";
import { addLeadGenerationJob } from "../queues/leadGeneration.queue";
import { logger } from "../../../utils/logger";

export class LeadGenerationService {
  private static getRequestRepo() {
    return AppDataSource.getMongoRepository(LeadGenerationRequest);
  }

  private static getLeadRepo() {
    return AppDataSource.getMongoRepository(GeneratedLead);
  }

  /**
   * Creates a new lead generation request, stores prompt in DB, and dispatches async job.
   */
  static async createLeadGeneration(userId: string, input: CreateLeadGenerationDTO) {
    const validated = LeadValidationService.validateCreateInput(input);

    // Rate Limit Check
    const rateLimit = await LeadGenerationLimitService.checkAndIncrement(userId);
    if (!rateLimit.allowed) {
      const error: any = new Error(
        `Rate limit exceeded for lead generation. Limit resets at ${rateLimit.resetTime.toISOString()}`
      );
      error.status = 429;
      error.statusCode = 429;
      error.resetTime = rateLimit.resetTime;
      throw error;
    }

    const { prompt, version } = PromptBuilderService.buildPrompt({
      businessNames: validated.businessNames,
      locations: validated.locations,
      additionalRequirement: validated.additionalRequirement
    });

    const provider = (
      process.env.AI_PROVIDER ||
      (process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY ? "gemini" : "openai")
    ).toLowerCase();

    const model =
      provider === "gemini"
        ? (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").replace(/^models\//, "").trim()
        : (process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini").trim();

    const requestRepo = this.getRequestRepo();
    const now = new Date();

    const leadReq = new LeadGenerationRequest();
    leadReq.userId = userId;
    leadReq.businessNames = validated.businessNames;
    leadReq.locations = validated.locations;
    leadReq.additionalRequirement = validated.additionalRequirement;
    leadReq.generatedPrompt = prompt;
    leadReq.promptVersion = version;
    leadReq.provider = provider;
    leadReq.model = model;
    leadReq.status = LeadGenerationStatus.PENDING;
    leadReq.leadCount = 0;
    leadReq.version = 1;
    leadReq.isDeleted = false;
    leadReq.createdAt = now;
    leadReq.updatedAt = now;

    // Pre-store generated prompt in MongoDB BEFORE AI invocation
    const saved = await requestRepo.save(leadReq);

    // Dispatch async BullMQ job
    try {
      await addLeadGenerationJob({
        generationId: saved._id.toString(),
        userId
      });
    } catch (queueErr: any) {
      logger.error(`Failed to enqueue lead generation job: ${queueErr.message}`);
      // Keep DB record in PENDING or update to reflect error if queue is down
    }

    return saved;
  }

  /**
   * Retrieves paginated list of lead generations for a user.
   */
  static async getLeadGenerations(
    userId: string,
    options: { page?: number; limit?: number; status?: string }
  ) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
    const skip = (page - 1) * limit;

    const requestRepo = this.getRequestRepo();
    const query: any = {
      userId,
      isDeleted: false
    };

    if (options.status) {
      query.status = options.status;
    }

    const [items, total] = await Promise.all([
      requestRepo.find({
        where: query,
        order: { createdAt: "DESC" },
        skip,
        take: limit
      }),
      requestRepo.countBy(query)
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Retrieves a single lead generation by ID with strict ownership validation.
   */
  static async getLeadGenerationById(userId: string, generationId: string) {
    if (!generationId || !ObjectId.isValid(generationId)) {
      const err: any = new Error("Invalid generation ID");
      err.status = 400;
      throw err;
    }

    const requestRepo = this.getRequestRepo();
    const item = await requestRepo.findOneBy({
      _id: new ObjectId(generationId) as any,
      isDeleted: false
    });

    if (!item) {
      const err: any = new Error("Lead generation request not found");
      err.status = 404;
      throw err;
    }

    if (item.userId !== userId) {
      const err: any = new Error("Unauthorized to access this lead generation request");
      err.status = 403;
      throw err;
    }

    return item;
  }

  /**
   * Edits the prompt for a lead generation request.
   */
  static async updatePrompt(userId: string, generationId: string, input: UpdatePromptDTO) {
    const validated = LeadValidationService.validatePromptUpdate(input);
    const item = await this.getLeadGenerationById(userId, generationId);

    if (item.status === LeadGenerationStatus.PROCESSING) {
      const err: any = new Error("Cannot edit prompt while generation is currently processing");
      err.status = 409;
      throw err;
    }

    item.generatedPrompt = validated.prompt;
    item.updatedAt = new Date();

    const requestRepo = this.getRequestRepo();
    return await requestRepo.save(item);
  }

  /**
   * Regenerates leads based on an existing search, creating a new version.
   */
  static async regenerate(userId: string, generationId: string, promptOverride?: string) {
    const parent = await this.getLeadGenerationById(userId, generationId);

    // Rate Limit Check
    const rateLimit = await LeadGenerationLimitService.checkAndIncrement(userId);
    if (!rateLimit.allowed) {
      const error: any = new Error(
        `Rate limit exceeded for lead generation. Limit resets at ${rateLimit.resetTime.toISOString()}`
      );
      error.status = 429;
      error.statusCode = 429;
      error.resetTime = rateLimit.resetTime;
      throw error;
    }

    const finalPrompt = promptOverride?.trim() || parent.generatedPrompt;
    const requestRepo = this.getRequestRepo();
    const now = new Date();

    const newReq = new LeadGenerationRequest();
    newReq.userId = userId;
    newReq.businessNames = parent.businessNames;
    newReq.locations = parent.locations;
    newReq.additionalRequirement = parent.additionalRequirement;
    newReq.generatedPrompt = finalPrompt;
    newReq.promptVersion = parent.promptVersion;
    newReq.provider = parent.provider;
    newReq.model = parent.model;
    newReq.status = LeadGenerationStatus.PENDING;
    newReq.leadCount = 0;
    newReq.version = (parent.version || 1) + 1;
    newReq.parentGenerationId = parent._id.toString();
    newReq.isDeleted = false;
    newReq.createdAt = now;
    newReq.updatedAt = now;

    const saved = await requestRepo.save(newReq);

    // Enqueue job for background processing
    try {
      await addLeadGenerationJob({
        generationId: saved._id.toString(),
        userId,
        promptOverride: finalPrompt
      });
    } catch (queueErr: any) {
      logger.error(`Failed to enqueue regenerated lead job: ${queueErr.message}`);
    }

    return saved;
  }

  /**
   * Retrieves generated leads for a generation request.
   */
  static async getLeads(
    userId: string,
    generationId: string,
    options: { page?: number; limit?: number }
  ) {
    // Ownership check
    await this.getLeadGenerationById(userId, generationId);

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const leadsRepo = this.getLeadRepo();
    const query = {
      generationId,
      isDeleted: false
    };

    const [items, total] = await Promise.all([
      leadsRepo.find({
        where: query,
        order: { createdAt: "DESC" },
        skip,
        take: limit
      }),
      leadsRepo.countBy(query)
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Soft-deletes a lead generation request and its associated leads.
   */
  static async deleteLeadGeneration(userId: string, generationId: string) {
    const item = await this.getLeadGenerationById(userId, generationId);
    const requestRepo = this.getRequestRepo();
    const leadsRepo = this.getLeadRepo();

    item.isDeleted = true;
    item.updatedAt = new Date();
    await requestRepo.save(item);

    // Soft delete associated leads
    await leadsRepo.updateMany(
      { generationId },
      { $set: { isDeleted: true, updatedAt: new Date() } }
    );

    return { success: true, message: "Lead generation deleted successfully" };
  }
}
