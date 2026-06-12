import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Plan } from "../entity/Plan";
import { MemberSubscription } from "../entity/MemberSubscription";
import { Payment } from "../entity/Payment";
import { SubscriptionFeatureUsage } from "../entity/SubscriptionFeatureUsage";
import { BadRequestError, NotFoundError } from "routing-controllers";

export class SubscriptionService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private subRepo = AppDataSource.getMongoRepository(MemberSubscription);
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
  private usageRepo = AppDataSource.getMongoRepository(SubscriptionFeatureUsage);

  /**
   * Helper to fetch the currently active subscription for a member.
   * If none exists or has expired, it returns virtual guest subscription.
   */
  async getActiveSubscription(memberId: string | ObjectId) {
    const memberObjectId = new ObjectId(memberId);
    const now = new Date();

    // 1. Fetch member
    const member = await this.memberRepo.findOneBy({ _id: memberObjectId, isDeleted: false });
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    let activeSub: MemberSubscription | null = null;

    // 2. Fetch the linked subscription
    if (member.subscriptionId) {
      activeSub = await this.subRepo.findOneBy({
        _id: member.subscriptionId,
        memberId: memberObjectId,
        status: "ACTIVE",
        isDeleted: false
      });
    }

    // 3. If no active sub found by ID, query ACTIVE subs from DB
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

    // 4. If no active subscription exists, return virtual guest subscription
    if (!activeSub) {
      return this.getVirtualGuestSubscription(member.createdAt || now);
    }

    // 5. Check if subscription has expired
    if (activeSub.endDate && activeSub.endDate < now) {
      // Mark as expired
      activeSub.status = "EXPIRED";
      await this.subRepo.save(activeSub);

      // Remove subscriptionId and planId reference from member
      await this.memberRepo.update(memberObjectId, { subscriptionId: null as any, planId: null as any });
      return this.getVirtualGuestSubscription(now);
    }

    // 6. Get Plan details
    const plan = activeSub.planId ? await this.planRepo.findOneBy({ _id: activeSub.planId, isDeleted: false }) : null;
    const planName = plan ? plan.title : "";
    const features = (plan && plan.features) ? plan.features : this.getDefaultGuestFeatures();

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

  /**
   * Helper to generate a virtual Guest Subscription object
   */
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

  /**
   * Start trial offer for a specific paid plan (Basic, Premium, Business, etc.)
   */
  async startTrial(memberId: string | ObjectId, planId: string) {
    const memberObjectId = new ObjectId(memberId);

    const member = await this.memberRepo.findOneBy({ _id: memberObjectId, isDeleted: false });
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Step 1 & 2: Check if profile is complete (needs fullName, mobileNumber, businessName)
    if (!member.fullName || !member.mobileNumber || !member.businessName) {
      throw new BadRequestError("Profile is incomplete. Please complete your profile to activate the trial.");
    }

    // Step 5: Prevent multiple trials
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

    // Ensure the plan has a trial period
    if (!trialPlan.trialDays || trialPlan.trialDays <= 0) {
      throw new BadRequestError(`The plan "${trialPlan.title}" does not offer a free trial period.`);
    }

    // Expire current active subscription
    await this.subRepo.updateMany(
      { memberId: memberObjectId, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + trialPlan.trialDays);

    const newSub = new MemberSubscription();
    newSub.memberId = memberObjectId;
    newSub.planId = trialPlan._id;
    newSub.type = trialPlan.type || "BASIC";
    newSub.status = "ACTIVE";
    newSub.startDate = now;
    newSub.endDate = end;
    newSub.isTrial = true;
    newSub.isDeleted = false;

    const savedSub = await this.subRepo.save(newSub);

    // Update member record
    member.hasUsedTrial = true;
    member.subscriptionId = savedSub._id;
    member.planId = trialPlan._id;
    await this.memberRepo.save(member);

    return savedSub;
  }

  /**
   * Payment flow: Step 1 - Create Payment Record
   */
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

  /**
   * Payment flow: Step 2 - Verify payment and trigger activation
   */
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

  /**
   * Payment flow: Step 3 - Activate Premium/Business subscription
   */
  async activateSubscription(memberId: ObjectId, planId: ObjectId, paymentId: ObjectId) {
    const plan = await this.planRepo.findOneBy({ _id: planId, isDeleted: false });
    if (!plan) {
      throw new NotFoundError("Plan not found");
    }

    // 1. Expire current ACTIVE subscriptions
    await this.subRepo.updateMany(
      { memberId, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    // 2. Create new MemberSubscription
    const now = new Date();
    const end = new Date();
    if (plan.billingCycle === "yearly") {
      end.setFullYear(end.getFullYear() + 1);
    } else {
      end.setMonth(end.getMonth() + 1); // Monthly default
    }

    const newSub = new MemberSubscription();
    newSub.memberId = memberId;
    newSub.planId = planId;
    newSub.type = plan.type || "FREE"; // "PREMIUM" | "BUSINESS"
    newSub.status = "ACTIVE";
    newSub.startDate = now;
    newSub.endDate = end;
    newSub.isDeleted = false;

    const savedSub = await this.subRepo.save(newSub);

    // 3. Update payment history with linked subscriptionId
    await this.paymentRepo.update(paymentId, { subscriptionId: savedSub._id });

    // 4. Update member.subscriptionId and planId
    await this.memberRepo.update(memberId, { subscriptionId: savedSub._id, planId: planId });

    return savedSub;
  }

  /**
   * Cancel subscription: immediately cancels paid subscription
   */
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

    // Mark current as CANCELLED
    activeSub.status = "CANCELLED";
    await this.subRepo.save(activeSub);

    // Update member subscriptionId and planId
    await this.memberRepo.update(memberObjectId, { subscriptionId: null as any, planId: null as any });

    return {
      message: "Subscription cancelled successfully.",
      currentSubscription: this.getVirtualGuestSubscription(new Date())
    };
  }

  /**
   * Check feature access validation helper
   */
  async checkFeatureAccess(memberId: string | ObjectId, featureType: string): Promise<boolean> {
    const activeSub = await this.getActiveSubscription(memberId);

    // 1. Resolve direct boolean features
    const featureVal = (activeSub.features as any)[featureType];
    if (typeof featureVal === "boolean") {
      return featureVal;
    }

    // 2. Resolve string features (like searchType: "basic" | "advanced")
    if (featureType === "searchType" || featureType === "requirementsAccess") {
      return !!featureVal;
    }

    // 3. Resolve limited counts (maxConnections, maxMessages)
    if (featureType === "maxConnections" || featureType === "maxMessages") {
      const limit = Number(featureVal);
      if (limit === -1) return true; // Unlimited

      // Query usage
      const usageType = featureType === "maxConnections" ? "connections_created" : "messages_sent";
      const usage = await this.getOrCreateFeatureUsage(new ObjectId(memberId), activeSub.subscriptionId || new ObjectId("000000000000000000000000"), usageType);

      if (usage.count >= limit) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Increments feature usage count for a member
   */
  async incrementFeatureUsage(memberId: string | ObjectId, featureType: "connections_created" | "messages_sent") {
    const memberObjectId = new ObjectId(memberId);
    const activeSub = await this.getActiveSubscription(memberObjectId);

    const usage = await this.getOrCreateFeatureUsage(memberObjectId, activeSub.subscriptionId || new ObjectId("000000000000000000000000"), featureType);
    usage.count += 1;
    await this.usageRepo.save(usage);
  }

  /**
   * Retrieves or creates feature usage log (checking reset dates)
   */
  private async getOrCreateFeatureUsage(memberId: ObjectId, subscriptionId: ObjectId, featureType: string): Promise<SubscriptionFeatureUsage> {
    const now = new Date();
    let usage = await this.usageRepo.findOneBy({
      memberId,
      subscriptionId,
      featureType
    });

    if (!usage) {
      usage = new SubscriptionFeatureUsage();
      usage.memberId = memberId;
      usage.subscriptionId = subscriptionId;
      usage.featureType = featureType;
      usage.count = 0;
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1); // 30-day reset
      usage.resetDate = nextReset;
      usage = await this.usageRepo.save(usage);
    } else if (usage.resetDate < now) {
      // Reset limit
      usage.count = 0;
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);
      usage.resetDate = nextReset;
      usage = await this.usageRepo.save(usage);
    }

    return usage;
  }

  /**
   * Fallback default features for Guest/Restricted Access
   */
  private getDefaultGuestFeatures() {
    return {
      maxConnections: 0,
      maxMessages: 0,
      searchType: "basic",
      requirementsAccess: "public",
      featuredProfile: false,
      priorityVisibility: false,
      trustAnalytics: false,
      businessInsights: false,
      teamManagement: false,
      leadGeneration: false,
      dashboard: false,
      premiumBranding: false,
    };
  }
}
