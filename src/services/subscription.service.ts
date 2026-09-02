import crypto from "crypto";
import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Plan } from "../entity/Plan";
import { MemberSubscription } from "../entity/MemberSubscription";
import { Payment } from "../entity/Payment";
import { PostModel, PostType } from "../entity/Post";
import { Referral } from "../entity/Referral";
import { Message, MessageType } from "../entity/Message";
import { MemberTraining } from "../entity/MemberTraining";
import { Milestone } from "../entity/Milestone";
import { AnnouncementBooking } from "../entity/AnnouncementBooking";
import { OnlineStallProduct } from "../entity/OnlineStallProduct";
import { StallBooking } from "../entity/StallBooking";
import { OneToOne } from "../entity/OneToOne";
import { ThankYouSlip } from "../entity/ThankYouSlip";
import { UserReferral } from "../entity/UserReferral";
import { BadRequestError, NotFoundError } from "routing-controllers";

export interface ModuleUsageConfig {
  entity: any;
  getFilter: (memberId: ObjectId) => Record<string, any>;
  dateField?: string;
}

export const MODULE_USAGE_CONFIG: Record<string, ModuleUsageConfig> = {
  "thank you slip": {
    entity: ThankYouSlip,
    getFilter: (memberId: ObjectId) => ({
      $or: [{ senderId: memberId }, { receiverId: memberId }],
      isDeleted: { $ne: true }
    }),
    dateField: "createdAt"
  },
  "one to one": {
    entity: OneToOne,
    getFilter: (memberId: ObjectId) => ({
      $or: [{ senderId: memberId }, { receiverId: memberId }],
      isDeleted: { $ne: true }
    }),
    dateField: "createdAt"
  },
  "ask": {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.ASK,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "give": {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.GIVE,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "promotion": {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.PROMOTION,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "requirement": {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.REQUIREMENT,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "post": {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.PROMOTION,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "referral": {
    entity: Referral,
    getFilter: (memberId: ObjectId) => ({
      senderId: memberId,
      isDeleted: { $ne: true }
    }),
    dateField: "createdAt"
  },
  "trainings": {
    entity: MemberTraining,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: { $ne: true }
    }),
    dateField: "createdAt"
  },
  "milestone": {
    entity: Milestone,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "event": {
    entity: AnnouncementBooking,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      status: "booked"
    }),
    dateField: "createdAt"
  },
  "marketplace": {
    entity: OnlineStallProduct,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "offline stall": {
    entity: StallBooking,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      status: "booked"
    }),
    dateField: "createdAt"
  }
};

export class SubscriptionService {
  private get memberRepo() {
    return AppDataSource.getMongoRepository(Member);
  }
  private get planRepo() {
    return AppDataSource.getMongoRepository(Plan);
  }
  private get subRepo() {
    return AppDataSource.getMongoRepository(MemberSubscription);
  }
  private get paymentRepo() {
    return AppDataSource.getMongoRepository(Payment);
  }

  /**
   * Helper: Normalize module name strings (e.g. "Milestones" -> "milestone")
   * Special cases that must stay plural are listed in the exceptions set.
   */
  normalizeModuleName(name: string): string {
    const lower = name.trim().toLowerCase();
    // Multi-word or known keys — return as-is
    if (lower === "one to one" || lower === "onetoone") return "one to one";
    if (lower === "thank you slip" || lower === "thankyouslip") return "thank you slip";
    if (lower === "online stall") return "marketplace";
    // Keys in MODULE_USAGE_CONFIG that are stored as plurals
    const keepPlural = new Set(["trainings"]);
    if (keepPlural.has(lower)) return lower;
    // Strip trailing 's' for other plural module names
    if (lower.endsWith("s") && lower !== "glass" && lower !== "business") {
      return lower.substring(0, lower.length - 1);
    }
    return lower;
  }

  /**
   * Helper to retrieve active plan configurations for a specific member
   */
  async getMemberPlan(memberId: string | ObjectId): Promise<Plan> {
    const memberOid = new ObjectId(memberId);
    const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    if (!member.planId) {
      throw new BadRequestError("No subscription plan is currently active for this member.");
    }

    const now = new Date();
    if (member.subscriptionStartDate && member.subscriptionStartDate > now) {
      throw new BadRequestError("Subscription plan has not started yet.");
    }

    if (member.subscriptionEndDate && member.subscriptionEndDate < now) {
      throw new BadRequestError("Subscription plan has expired.");
    }

    const plan = await this.planRepo.findOneBy({ _id: new ObjectId(member.planId), isDeleted: false });
    if (!plan) {
      throw new NotFoundError("Assigned subscription plan not found.");
    }

    if (plan.status !== "active") {
      throw new BadRequestError("Assigned subscription plan is currently inactive.");
    }

    return plan;
  }

  /**
   * Core validator for usage-based modules
   */
  async validateModuleUsage(memberId: string | ObjectId, moduleName: string): Promise<void> {
    const memberOid = new ObjectId(memberId);
    const plan = await this.getMemberPlan(memberOid);
    const normalized = this.normalizeModuleName(moduleName);

    // Feature permission checks based on plan.features config
    if (
      normalized === "event" ||
      normalized === "eventvisitor" ||
      normalized === "event visitor"
    ) {
      if (plan.features && plan.features.eventVisitor === false) {
        throw new BadRequestError("Event Visitor permission is not enabled in your active plan.");
      }
      return;
    }

    if (
      normalized === "offline stall" ||
      normalized === "offlinestall" ||
      normalized === "eventstall" ||
      normalized === "event stall"
    ) {
      if (plan.features && plan.features.eventStall === false) {
        throw new BadRequestError("Event Stall permission is not enabled in your active plan.");
      }
      const planModule = plan.modules?.find(
        (m) => this.normalizeModuleName(m.moduleName) === normalized
      );
      if (!planModule) {
        return;
      }
    }

    if (normalized === "spotlight" || normalized === "spotlights") {
      if (plan.features && plan.features.spotlights === false) {
        throw new BadRequestError("Spotlights permission is not enabled in your active plan.");
      }
      const planModule = plan.modules?.find(
        (m) => this.normalizeModuleName(m.moduleName) === normalized
      );
      if (!planModule) {
        return;
      }
    }

    if (normalized === "monthly meeting" || normalized === "monthlymeeting") {
      if (plan.features && plan.features.monthlyMeeting === false) {
        throw new BadRequestError("Monthly Meeting permission is not enabled in your active plan.");
      }
      const planModule = plan.modules?.find(
        (m) => this.normalizeModuleName(m.moduleName) === normalized
      );
      if (!planModule) {
        return;
      }
    }

    const planModule = plan.modules?.find(
      (m) => this.normalizeModuleName(m.moduleName) === normalized
    );

    if (!planModule) {
      throw new BadRequestError(`Module "${moduleName}" is not included in your active plan.`);
    }

    if (planModule.countLimit === -1) {
      return;
    }

    const { startDate, endDate } = this.getDateRangeByFrequency(planModule.frequency, planModule.frequencyValue);
    const used = await this.getCurrentUsageCount(memberOid, normalized, startDate, endDate);

    if (used >= planModule.countLimit) {
      throw this.buildLimitExceededError(planModule.moduleName, used, planModule.countLimit, planModule.frequency);
    }
  }

  /**
   * Validator for requirement post response limits
   */
  async validateRequirementResponseLimit(memberId: string | ObjectId): Promise<void> {
    const memberOid = new ObjectId(memberId);
    const plan = await this.getMemberPlan(memberOid);

    // Get response limit from benefits config
    const limit = plan.benefits?.requirementResponseLimit;
    if (limit === undefined || limit === null) {
      throw new BadRequestError("Requirement response benefit is not configured in your active plan.");
    }

    if (limit === -1) {
      return; // Unlimited responses allowed
    }

    // Determine the frequency and frequency value based on the Requirement module config, default to daily
    const requirementModule = plan.modules?.find(
      (m) => this.normalizeModuleName(m.moduleName) === "requirement"
    );
    const frequency = requirementModule?.frequency || "daily";
    const frequencyValue = requirementModule?.frequencyValue || 1;

    const { startDate, endDate } = this.getDateRangeByFrequency(frequency, frequencyValue);

    // Get messages sent by the member of type POST_RESPONSE within the date range
    const messages = await AppDataSource.getMongoRepository(Message).find({
      where: {
        senderId: memberOid,
        type: MessageType.POST_RESPONSE,
        isDeleted: { $ne: true },
        createdAt: {
          $gte: startDate,
          $lte: endDate
        }
      } as any
    });

    if (messages.length === 0) {
      return;
    }

    const postIds = messages
      .map((msg) => {
        if (!msg.postId) return null;
        try {
          return new ObjectId(msg.postId.toString());
        } catch {
          return null;
        }
      })
      .filter((id): id is ObjectId => !!id);

    if (postIds.length === 0) {
      return;
    }

    // Count how many of those posts are of type REQUIREMENT
    const used = await AppDataSource.getMongoRepository(PostModel).count({
      _id: { $in: postIds },
      type: PostType.REQUIREMENT,
      isDeleted: false
    } as any);

    if (used >= limit) {
      throw new BadRequestError(
        `${frequency ? frequency.charAt(0).toUpperCase() + frequency.slice(1) : "Daily"} limit of ${limit} response(s) reached. Upgrade your plan to continue.`
      );
    }
  }

  /**
   * Core validator for binary features access
   */
  async validateFeatureAccess(memberId: string | ObjectId, featureName: keyof Plan["features"]): Promise<void> {
    const memberOid = new ObjectId(memberId);
    const plan = await this.getMemberPlan(memberOid);

    const hasAccess = plan.features?.[featureName];
    if (!hasAccess) {
      throw new BadRequestError("This feature is not available in your current subscription plan.");
    }
  }

  /**
   * Counts actual current usage logs in database
   */
  async getCurrentUsageCount(memberId: ObjectId, moduleName: string, startDate: Date, endDate: Date): Promise<number> {
    const normalized = this.normalizeModuleName(moduleName);
    const config = MODULE_USAGE_CONFIG[normalized];
    if (!config) {
      throw new BadRequestError(`No usage configuration found for module: ${moduleName}`);
    }

    const repo = AppDataSource.getMongoRepository(config.entity);
    const filter = config.getFilter(memberId);
    const dateField = config.dateField || "createdAt";

    const finalFilter = {
      ...filter,
      [dateField]: {
        $gte: startDate,
        $lte: endDate
      }
    };

    return repo.count(finalFilter as any);
  }

  /**
   * Central API to fetch remaining usage details
   */
  async getRemainingUsage(memberId: string | ObjectId, moduleName: string) {
    const memberOid = new ObjectId(memberId);
    const plan = await this.getMemberPlan(memberOid);
    const normalized = this.normalizeModuleName(moduleName);

    const planModule = plan.modules?.find(
      (m) => this.normalizeModuleName(m.moduleName) === normalized
    );

    if (!planModule) {
      return {
        moduleName,
        used: 0,
        limit: 0,
        remaining: 0,
        frequency: "none"
      };
    }

    if (planModule.countLimit === -1) {
      return {
        moduleName: planModule.moduleName,
        used: 0,
        limit: -1,
        remaining: -1,
        frequency: planModule.frequency
      };
    }

    const { startDate, endDate } = this.getDateRangeByFrequency(planModule.frequency, planModule.frequencyValue);
    const used = await this.getCurrentUsageCount(memberOid, normalized, startDate, endDate);
    const remaining = Math.max(0, planModule.countLimit - used);

    return {
      moduleName: planModule.moduleName,
      used,
      limit: planModule.countLimit,
      remaining,
      frequency: planModule.frequency
    };
  }

  /**
   * Central API to fetch card usage counts & plan limits for the 5 post creation modules in member's plan:
   * (Post, Ask, Give, Requirement, Milestones)
   */
  async getCardDailyCounts(memberId: string | ObjectId) {
    const memberOid = new ObjectId(memberId);
    let plan: Plan | null = null;
    try {
      plan = await this.getMemberPlan(memberOid);
    } catch {
      return {
        planId: null,
        planTitle: "No Active Plan",
        modules: []
      };
    }

    if (!plan || !plan.modules || !Array.isArray(plan.modules)) {
      return {
        planId: plan?._id ? plan._id.toString() : null,
        planTitle: plan?.title || "No Plan",
        modules: []
      };
    }

    const allowedModules = new Set(["post", "ask", "give", "requirement", "milestone"]);

    const targetModules = plan.modules.filter((m) =>
      allowedModules.has(this.normalizeModuleName(m.moduleName))
    );

    const cards = await Promise.all(
      targetModules.map(async (planModule) => {
        const normalized = this.normalizeModuleName(planModule.moduleName);
        const frequency = planModule.frequency || "daily";
        const frequencyValue = planModule.frequencyValue || 1;
        const countLimit = planModule.countLimit;

        let usedCount = 0;
        if (MODULE_USAGE_CONFIG[normalized]) {
          const { startDate, endDate } = this.getDateRangeByFrequency(frequency, frequencyValue);
          usedCount = await this.getCurrentUsageCount(memberOid, normalized, startDate, endDate);
        }

        const remainingCount = countLimit === -1 ? -1 : Math.max(0, countLimit - usedCount);
        const canPost = countLimit === -1 || usedCount < countLimit;

        return {
          moduleName: planModule.moduleName,
          countLimit,
          usedCount,
          remainingCount,
          canPost,
          frequency,
          frequencyValue
        };
      })
    );

    return {
      planId: plan._id ? plan._id.toString() : null,
      planTitle: plan.title,
      modules: cards
    };
  }

  /**
   * Retrieves the start/end date range bounds matching the limit's frequency
   */
  getDateRangeByFrequency(frequency: string, frequencyValue: number): { startDate: Date; endDate: Date } {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
    const now = new Date();

    // Shift current time to IST calendar time
    const istEndDate = new Date(now.getTime() + IST_OFFSET);
    const istStartDate = new Date(now.getTime() + IST_OFFSET);

    switch (frequency.toLowerCase()) {
    case "daily":
      istStartDate.setUTCDate(istEndDate.getUTCDate() - frequencyValue + 1);
      istStartDate.setUTCHours(0, 0, 0, 0);
      break;
    case "weekly":
      const day = istEndDate.getUTCDay();
      istStartDate.setUTCDate(istEndDate.getUTCDate() - day - (7 * (frequencyValue - 1)));
      istStartDate.setUTCHours(0, 0, 0, 0);
      break;
    case "monthly":
      istStartDate.setUTCMonth(istEndDate.getUTCMonth() - frequencyValue + 1);
      istStartDate.setUTCDate(1);
      istStartDate.setUTCHours(0, 0, 0, 0);
      break;
    case "yearly":
      istStartDate.setUTCFullYear(istEndDate.getUTCFullYear() - frequencyValue + 1);
      istStartDate.setUTCMonth(0, 1);
      istStartDate.setUTCHours(0, 0, 0, 0);
      break;
    default:
      throw new BadRequestError(`Unsupported module limitation frequency: ${frequency}`);
    }

    // Shift back to get correct UTC dates
    const startDate = new Date(istStartDate.getTime() - IST_OFFSET);
    const endDate = now;

    return { startDate, endDate };
  }

  /**
   * Helper exception builder
   */
  buildLimitExceededError(moduleName: string, used: number, limit: number, frequency: string): BadRequestError {
    return new BadRequestError(
      `${frequency ? frequency.charAt(0).toUpperCase() + frequency.slice(1) : "Daily"} upload limit reached. Try again later or upgrade your plan.`
    );
  }

  /**
   * Returns plan benefits
   */
  async getPlanBenefits(memberId: string | ObjectId) {
    const plan = await this.getMemberPlan(memberId);
    return {
      modules: plan.modules,
      features: plan.features,
      benefits: plan.benefits
    };
  }

  // =========================================================================
  // BACKWARD COMPATIBLE FLOW FOR PAYMENTS AND TRIALS
  // =========================================================================

  async getActiveSubscription(memberId: string | ObjectId) {
    const memberObjectId = new ObjectId(memberId);
    const now = new Date();

    const member = await this.memberRepo.findOneBy({ _id: memberObjectId, isDeleted: false });
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    let activeSub: MemberSubscription | null = null;
    if (member.subscriptionId) {
      activeSub = await this.subRepo.findOneBy({
        _id: member.subscriptionId,
        memberId: memberObjectId,
        status: "ACTIVE",
        isDeleted: false
      });
    }

    if (!activeSub) {
      activeSub = await this.subRepo.findOne({
        where: {
          memberId: memberObjectId,
          status: "ACTIVE",
          isDeleted: false
        },
        order: { startDate: "DESC" }
      });
    }

    if (!activeSub) {
      return this.getVirtualGuestSubscription(member.createdAt || now);
    }

    if (activeSub.endDate && activeSub.endDate < now) {
      activeSub.status = "EXPIRED";
      await this.subRepo.save(activeSub);
      await this.memberRepo.update(memberObjectId, { subscriptionId: null as any, planId: null as any });
      return this.getVirtualGuestSubscription(now);
    }

    const plan = activeSub.planId ? await this.planRepo.findOneBy({ _id: activeSub.planId, isDeleted: false }) : null;
    const planName = plan ? plan.title : "";
    const features = plan && plan.features ? plan.features : this.getDefaultGuestFeatures();

    const diffTime = activeSub.endDate.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    let totalDays = 0;
    if (activeSub.startDate && activeSub.endDate) {
      totalDays = Math.max(1, Math.round((activeSub.endDate.getTime() - activeSub.startDate.getTime()) / (1000 * 60 * 60 * 24)));
    }

    let totalTrialDays = 0;
    if (activeSub.isTrial) {
      totalTrialDays = totalDays > 0 ? totalDays : (plan?.trialDays || 0);
    }

    return {
      subscriptionId: activeSub._id || null,
      planId: activeSub.planId || null,
      planName,
      type: plan?.billingType?.toUpperCase() ?? "",
      status: activeSub.status,
      startDate: activeSub.startDate,
      endDate: activeSub.endDate,
      daysRemaining,
      totalDays,
      totalTrialDays,
      features,
      isTrial: activeSub.isTrial || false
    };
  }

  private getVirtualGuestSubscription(startDate: Date) {
    return {
      subscriptionId: null,
      planId: null,
      planName: "Guest",
      type: "FREE",
      status: "EXPIRED",
      startDate,
      endDate: startDate,
      daysRemaining: 0,
      totalDays: 0,
      totalTrialDays: 0,
      isTrial: false,
      features: this.getDefaultGuestFeatures()
    };
  }

  private getDefaultGuestFeatures() {
    return {
      monthlyMeeting: false,
      eventVisitor: false,
      eventStall: false,
      spotlights: false
    };
  }

  async startTrial(memberId: string | ObjectId, planId: string) {
    const memberObjectId = new ObjectId(memberId);

    const member = await this.memberRepo.findOneBy({ _id: memberObjectId, isDeleted: false });
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    if (!member.fullName || !member.mobileNumber || !member.businessName) {
      throw new BadRequestError("Profile is incomplete. Please complete your profile to activate the trial.");
    }

    if (member.hasUsedTrial) {
      throw new BadRequestError("You have already used your trial plan.");
    }

    if (!planId) {
      throw new BadRequestError("Plan ID is required to start a trial");
    }

    if (!ObjectId.isValid(planId)) {
      throw new BadRequestError("Invalid Plan ID");
    }

    const trialPlan = await this.planRepo.findOneBy({ _id: new ObjectId(planId), isDeleted: false });
    if (!trialPlan) {
      throw new NotFoundError("Selected plan not found");
    }

    // Determine if the member registered using a referral code
    let isReferred = Boolean(member.referredBy);
    if (!isReferred) {
      const userReferralRepo = AppDataSource.getMongoRepository(UserReferral);
      const referralRecord = await userReferralRepo.findOneBy({ referredUserId: memberObjectId });
      if (referralRecord) {
        isReferred = true;
      }
    }

    const allocatedTrialDays = isReferred ? 10 : (trialPlan.trialDays || 0);

    if (allocatedTrialDays <= 0) {
      throw new BadRequestError(`The plan "${trialPlan.title}" does not offer a free trial period.`);
    }

    await this.subRepo.updateMany(
      { memberId: memberObjectId, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + allocatedTrialDays);

    const newSub = new MemberSubscription();
    newSub.memberId = memberObjectId;
    newSub.planId = new ObjectId(trialPlan._id);
    newSub.type = trialPlan.billingType || "BASIC";
    newSub.status = "ACTIVE";
    newSub.startDate = now;
    newSub.endDate = end;
    newSub.isTrial = true;
    newSub.isDeleted = false;

    const savedSub = await this.subRepo.save(newSub);

    member.hasUsedTrial = true;
    member.subscriptionId = new ObjectId(savedSub._id);
    member.planId = new ObjectId(trialPlan._id);
    member.subscriptionStartDate = now;
    member.subscriptionEndDate = end;
    await this.memberRepo.save(member);

    try {
      const { ReferralService } = await import("./referral.service");
      await new ReferralService().handleReferredUserTrialStarted(memberObjectId);
    } catch (refErr: any) {
      console.error("[SubscriptionService] Referral trial reward hook notice:", refErr?.message || refErr);
    }

    return savedSub;
  }

  async isFirstTimeBuyer(memberId: string | ObjectId): Promise<boolean> {
    const memberObjectId = new ObjectId(memberId);

    // 1. Check for any completed payments with amount > 0
    const paidPayment = await this.paymentRepo.findOne({
      where: {
        memberId: memberObjectId,
        status: "COMPLETED",
        amount: { $gt: 0 },
        isDeleted: false
      } as any
    });
    if (paidPayment) return false;

    // 2. Check for any previous or active non-trial MemberSubscription
    const paidSub = await this.subRepo.findOne({
      where: {
        memberId: memberObjectId,
        isTrial: false,
        isDeleted: false
      } as any
    });
    if (paidSub) return false;

    return true;
  }

  async createSubscriptionPayment(memberId: string | ObjectId, planId: string, paymentMethod: string) {
    const memberObjectId = new ObjectId(memberId);
    const planObjectId = new ObjectId(planId);

    const plan = await this.planRepo.findOneBy({ _id: planObjectId, isDeleted: false });
    if (!plan) {
      throw new NotFoundError("Subscription plan not found");
    }

    const isFirstTime = await this.isFirstTimeBuyer(memberObjectId);
    const amountToCharge = isFirstTime && plan.offerPrice && plan.offerPrice > 0 ? plan.offerPrice : plan.amount;

    const transactionId = "TXN_" + crypto.randomBytes(8).toString("hex").toUpperCase();

    const payment = new Payment();
    payment.memberId = memberObjectId;
    payment.planId = planObjectId;
    payment.amount = amountToCharge;
    payment.paymentMethod = paymentMethod;
    payment.transactionId = transactionId;
    payment.status = "PENDING";
    payment.isDeleted = false;
    payment.action = "buy";
    try {
      const activeSub = await this.getActiveSubscription(memberObjectId);
      if (activeSub && activeSub.planId) {
        payment.previousPlanId = new ObjectId(activeSub.planId);
      }
    } catch (e) {
      console.error("Failed to get active subscription for payment previousPlanId:", e);
    }

    return this.paymentRepo.save(payment);
  }

  async verifyPayment(transactionId: string, status: "COMPLETED" | "FAILED") {
    const payment = await this.paymentRepo.findOneBy({ transactionId, isDeleted: false });
    if (!payment) {
      throw new NotFoundError("Payment transaction not found");
    }

    // Atomic state transition from PENDING to target status to prevent duplicate processing under concurrent webhooks
    const updateResult = await this.paymentRepo.updateOne(
      { _id: payment._id, status: "PENDING" },
      { $set: { status: status, updatedAt: new Date() } }
    );

    if (updateResult.matchedCount === 0) {
      // Payment already processed — idempotent response without duplicate subscription activation
      const existingPayment = await this.paymentRepo.findOneBy({ _id: payment._id });
      const activeSub = await this.getActiveSubscription(payment.memberId);
      return {
        payment: existingPayment || payment,
        subscription: activeSub,
        success: existingPayment?.status === "COMPLETED"
      };
    }

    payment.status = status;

    if (status === "COMPLETED") {
      const activeSub = await this.activateSubscription(payment.memberId, payment.planId, payment._id);
      return {
        payment: payment,
        subscription: activeSub,
        success: true
      };
    }

    return {
      payment: payment,
      success: false
    };
  }

  async activateSubscription(memberId: ObjectId, planId: ObjectId, paymentId: ObjectId) {
    const plan = await this.planRepo.findOneBy({ _id: planId, isDeleted: false });
    if (!plan) {
      throw new NotFoundError("Plan not found");
    }

    await this.subRepo.updateMany(
      { memberId, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    const now = new Date();
    const end = new Date();
    if (plan.billingCycle === "yearly") {
      end.setFullYear(end.getFullYear() + 1);
    } else {
      end.setMonth(end.getMonth() + 1);
    }

    const newSub = new MemberSubscription();
    newSub.memberId = memberId;
    newSub.planId = new ObjectId(planId);
    newSub.type = plan.billingType || "FREE";
    newSub.status = "ACTIVE";
    newSub.startDate = now;
    newSub.endDate = end;
    newSub.isDeleted = false;

    const savedSub = await this.subRepo.save(newSub);

    await this.paymentRepo.update(paymentId, { subscriptionId: savedSub._id });

    await this.memberRepo.update(memberId, {
      subscriptionId: new ObjectId(savedSub._id),
      planId: new ObjectId(planId),
      subscriptionStartDate: now,
      subscriptionEndDate: end
    });

    try {
      const { ReferralService } = await import("./referral.service");
      await new ReferralService().handleReferredUserSubscribed(memberId);
    } catch (refErr: any) {
      console.error("[SubscriptionService] Referral reward hook notice:", refErr.message);
    }

    return savedSub;
  }

  async cancelSubscription(memberId: string | ObjectId) {
    const memberObjectId = new ObjectId(memberId);

    const activeSub = await this.subRepo.findOneBy({
      memberId: memberObjectId,
      status: "ACTIVE",
      isDeleted: false
    });

    if (!activeSub) {
      throw new BadRequestError("You do not have any active paid subscription to cancel.");
    }

    activeSub.status = "CANCELLED";
    await this.subRepo.save(activeSub);

    await this.memberRepo.update(memberObjectId, {
      subscriptionId: null as any,
      planId: null as any,
      subscriptionStartDate: null as any,
      subscriptionEndDate: null as any
    });

    return {
      message: "Subscription cancelled successfully.",
      currentSubscription: this.getVirtualGuestSubscription(new Date())
    };
  }

  /**
   * Compatibility wrapper for old checkFeatureAccess middleware checks
   */
  async checkFeatureAccess(memberId: string | ObjectId, featureType: string): Promise<boolean> {
    try {
      const activeSub = await this.getActiveSubscription(memberId);

      // Resolve direct new boolean features
      if (activeSub.features && typeof (activeSub.features as any)[featureType] === "boolean") {
        return (activeSub.features as any)[featureType];
      }

      // Check module usage validation matching old features
      if (featureType === "maxConnections") {
        // Map to connections/direct-meet validation
        await this.validateModuleUsage(memberId, "one to one");
        return true;
      }

      if (featureType === "maxMessages") {
        // Map to chat messages limits
        await this.validateModuleUsage(memberId, "promotion"); // e.g. or chat
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // async incrementFeatureUsage(memberId: string | ObjectId, featureType: "connections_created" | "messages_sent") {
  //   // Keep as no-op or proxy for backward compatibility if called
  // }
}
