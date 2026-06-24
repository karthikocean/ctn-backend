import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Plan } from "../entity/Plan";
import { MemberSubscription } from "../entity/MemberSubscription";
import { Payment } from "../entity/Payment";
import { SubscriptionFeatureUsage } from "../entity/SubscriptionFeatureUsage";
import { PostModel, PostType } from "../entity/Post";
import { Referral } from "../entity/Referral";
import { MemberTraining } from "../entity/MemberTraining";
import { Milestone } from "../entity/Milestone";
import { AnnouncementBooking } from "../entity/AnnouncementBooking";
import { OnlineStallProduct } from "../entity/OnlineStallProduct";
import { StallBooking } from "../entity/StallBooking";
import { OneToOne } from "../entity/OneToOne";
import { ThankYouSlip } from "../entity/ThankYouSlip";
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
      type: { $ne: PostType.ASK },
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
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private subRepo = AppDataSource.getMongoRepository(MemberSubscription);
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
  private usageRepo = AppDataSource.getMongoRepository(SubscriptionFeatureUsage);

  /**
   * Helper: Normalize module name strings (e.g. "Milestones" -> "milestone")
   */
  normalizeModuleName(name: string): string {
    let lower = name.trim().toLowerCase();
    if (lower.endsWith("s") && lower !== "glass" && lower !== "business") {
      lower = lower.substring(0, lower.length - 1);
    }
    if (lower === "one to one" || lower === "onetoone") return "one to one";
    if (lower === "thank you slip" || lower === "thankyouslip") return "thank you slip";
    if (lower === "online stall") return "marketplace";
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

    const plan = await this.planRepo.findOneBy({ _id: member.planId, isDeleted: false });
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

    const planModule = plan.modules?.find(
      (m) => this.normalizeModuleName(m.moduleName) === normalized
    );

    if (!planModule) {
      throw new BadRequestError(`Access denied: Module "${moduleName}" is not included in your active plan.`);
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
   * Retrieves the start/end date range bounds matching the limit's frequency
   */
  getDateRangeByFrequency(frequency: string, frequencyValue: number): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    const startDate = new Date();

    switch (frequency.toLowerCase()) {
    case "daily":
      startDate.setDate(endDate.getDate() - frequencyValue + 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case "weekly":
      const day = endDate.getDay();
      startDate.setDate(endDate.getDate() - day - (7 * (frequencyValue - 1)));
      startDate.setHours(0, 0, 0, 0);
      break;
    case "monthly":
      startDate.setMonth(endDate.getMonth() - frequencyValue + 1);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case "yearly":
      startDate.setFullYear(endDate.getFullYear() - frequencyValue + 1);
      startDate.setMonth(0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      throw new BadRequestError(`Unsupported module limitation frequency: ${frequency}`);
    }

    return { startDate, endDate };
  }

  /**
   * Helper exception builder
   */
  buildLimitExceededError(moduleName: string, used: number, limit: number, frequency: string): BadRequestError {
    return new BadRequestError(
      `You've used your ${frequency.toLowerCase()} upload allowance. Please try again after your limit resets or upgrade your plan for additional uploads.`
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
    const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    return {
      subscriptionId: activeSub._id || null,
      planId: activeSub.planId || null,
      planName,
      type: activeSub.type,
      status: activeSub.status,
      startDate: activeSub.startDate,
      endDate: activeSub.endDate,
      daysRemaining,
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

    if (!trialPlan.trialDays || trialPlan.trialDays <= 0) {
      throw new BadRequestError(`The plan "${trialPlan.title}" does not offer a free trial period.`);
    }

    await this.subRepo.updateMany(
      { memberId: memberObjectId, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + trialPlan.trialDays);

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

    return savedSub;
  }

  async createSubscriptionPayment(memberId: string | ObjectId, planId: string, paymentMethod: string) {
    const memberObjectId = new ObjectId(memberId);
    const planObjectId = new ObjectId(planId);

    const plan = await this.planRepo.findOneBy({ _id: planObjectId, isDeleted: false });
    if (!plan) {
      throw new NotFoundError("Subscription plan not found");
    }

    const transactionId = "TXN_" + Math.random().toString(36).substr(2, 9).toUpperCase();

    const payment = new Payment();
    payment.memberId = memberObjectId;
    payment.planId = planObjectId;
    payment.amount = plan.amount;
    payment.paymentMethod = paymentMethod;
    payment.transactionId = transactionId;
    payment.status = "PENDING";
    payment.isDeleted = false;

    return this.paymentRepo.save(payment);
  }

  async verifyPayment(transactionId: string, status: "COMPLETED" | "FAILED") {
    const payment = await this.paymentRepo.findOneBy({ transactionId, isDeleted: false });
    if (!payment) {
      throw new NotFoundError("Payment transaction not found");
    }

    if (payment.status !== "PENDING") {
      throw new BadRequestError(`Payment has already been processed with status: ${payment.status}`);
    }

    payment.status = status;
    const updatedPayment = await this.paymentRepo.save(payment);

    if (status === "COMPLETED") {
      const activeSub = await this.activateSubscription(payment.memberId, payment.planId, payment._id);
      return {
        payment: updatedPayment,
        subscription: activeSub,
        success: true
      };
    }

    return {
      payment: updatedPayment,
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
    newSub.planId = planId;
    newSub.type = plan.billingType || "FREE";
    newSub.status = "ACTIVE";
    newSub.startDate = now;
    newSub.endDate = end;
    newSub.isDeleted = false;

    const savedSub = await this.subRepo.save(newSub);

    await this.paymentRepo.update(paymentId, { subscriptionId: savedSub._id });

    await this.memberRepo.update(memberId, {
      subscriptionId: savedSub._id,
      planId: planId,
      subscriptionStartDate: now,
      subscriptionEndDate: end
    });

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
        // Map to connections/one-to-one validation
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

  async incrementFeatureUsage(memberId: string | ObjectId, featureType: "connections_created" | "messages_sent") {
    // Keep as no-op or proxy for backward compatibility if called
  }
}
