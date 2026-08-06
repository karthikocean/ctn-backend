import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Plan } from "../entity/Plan";
import { Payment } from "../entity/Payment";
import { MemberSubscription } from "../entity/MemberSubscription";
import { SubscriptionService } from "./subscription.service";
import { BadRequestError, NotFoundError } from "routing-controllers";
import crypto from "crypto";
import { insertPushNotification } from "./pushnotification.service";
import { NotificationModule } from "../entity/PushNotifications";

const Razorpay = require("razorpay");

let razorpayInstance: any = null;

const getRazorpayInstance = () => {
  if (!razorpayInstance) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
      throw new BadRequestError("Razorpay credentials are not configured in the environment variables.");
    }

    razorpayInstance = new Razorpay({
      key_id,
      key_secret,
    });
  }
  return razorpayInstance;
};

export class RazorpayUpgradeService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
  private subService = new SubscriptionService();

  async getUpgradeBreakdown(memberId: string, newPlanId: string) {
    const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
    if (!member) throw new NotFoundError("Member not found");

    const newPlan = await this.planRepo.findOneBy({ _id: new ObjectId(newPlanId), isDeleted: false });
    if (!newPlan) throw new NotFoundError("Selected plan not found");

    const activeSub = await this.subService.getActiveSubscription(memberId);

    // Default values if no active sub or trial/free sub
    let currentPlanName = "None";
    let currentPlanPrice = 0;
    let totalDays = 0;
    let daysRemaining = 0;
    let daysUsed = 0;
    let proratedCredit = 0;
    let amountToCharge = newPlan.amount;

    if (activeSub && activeSub.subscriptionId && !activeSub.isTrial) {
      // Fetch current plan price
      const currentPlan = await this.planRepo.findOneBy({ _id: activeSub.planId || new ObjectId("000000000000000000000000") });
      const currentPrice = currentPlan ? currentPlan.amount : 0;
      currentPlanName = currentPlan ? currentPlan.title : "Unknown";
      currentPlanPrice = currentPrice;

      if (newPlan.amount <= currentPrice) {
        throw new BadRequestError("Cannot upgrade to a lower or equal value plan. Use the buy API to downgrade.");
      }

      const start = new Date(activeSub.startDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(activeSub.endDate);
      end.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const totalDuration = end.getTime() - start.getTime();

      if (totalDuration > 0) {
        totalDays = Math.max(0, Math.round(totalDuration / (1000 * 60 * 60 * 24)));
        const daysUsedRaw = Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        daysUsed = Math.min(totalDays, Math.max(1, daysUsedRaw + 1));
        daysRemaining = Math.max(0, totalDays - daysUsed);

        if (daysRemaining > 0) {
          const cycle = currentPlan?.billingCycle || "yearly";
          const daysInCycle = cycle === "monthly" ? 30 : 365;
          const perDayCost = currentPrice / daysInCycle;
          proratedCredit = Math.round((perDayCost * daysRemaining) * 100) / 100; // Keep 2 decimal places
          amountToCharge = Math.max(0, newPlan.amount - proratedCredit);
        }
      }
    } else if (activeSub && activeSub.isTrial) {
      currentPlanName = `${activeSub.planName} (Trial)`;
      currentPlanPrice = 0;
    }

    return {
      currentPlan: {
        id: activeSub?.planId?.toString() || null,
        title: currentPlanName,
        amount: currentPlanPrice,
      },
      newPlan: {
        id: newPlan._id.toString(),
        title: newPlan.title,
        amount: newPlan.amount,
      },
      durationDetails: {
        totalDays,
        daysRemaining,
        daysUsed,
      },
      proratedCredit,
      amountToPay: amountToCharge,
    };
  }

  async initiateUpgrade(memberId: string, newPlanId: string) {
    const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
    if (!member) throw new NotFoundError("Member not found");

    const breakdown = await this.getUpgradeBreakdown(memberId, newPlanId);

    if (breakdown.amountToPay <= 0) {
      throw new BadRequestError("You are eligible for a free downgrade/upgrade. Contact support.");
    }

    // 2. Create Razorpay Order
    // Razorpay amounts are in paise (e.g. ₹1 = 100 paise)
    const amountInPaise = Math.round(breakdown.amountToPay * 100);

    const rzpOrder = await getRazorpayInstance().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `upgrade_rcpt_${Date.now()}`,
    });

    // 3. Store Payment as PENDING in DB
    const payment = new Payment();
    payment.memberId = member._id;
    payment.planId = new ObjectId(newPlanId);
    payment.amount = breakdown.amountToPay;
    payment.paymentMethod = "razorpay";
    payment.transactionId = rzpOrder.id; // Using RZP Order ID for tracking
    payment.status = "PENDING";
    payment.isDeleted = false;
    payment.action = "upgrade";
    if (breakdown.currentPlan && breakdown.currentPlan.id) {
      payment.previousPlanId = new ObjectId(breakdown.currentPlan.id);
    }
    await this.paymentRepo.save(payment);

    return {
      razorpayOrderId: rzpOrder.id,
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID || "",
    };
  }

  async initiateBuy(memberId: string, planId: string) {
    const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
    if (!member) throw new NotFoundError("Member not found");

    const plan = await this.planRepo.findOneBy({ _id: new ObjectId(planId), isDeleted: false });
    if (!plan) throw new NotFoundError("Selected plan not found");

    const activeSub = await this.subService.getActiveSubscription(memberId);
    if (activeSub && activeSub.subscriptionId && !activeSub.isTrial) {
      const currentPlan = await this.planRepo.findOneBy({ _id: activeSub.planId || new ObjectId("000000000000000000000000") });
      const currentPrice = currentPlan ? currentPlan.amount : 0;
      if (plan.amount < currentPrice) {
        throw new BadRequestError("You have an active plan of higher value. Please use the downgrade API to downgrade and transfer your unused credits.");
      }
    }

    const amountToCharge = plan.amount; // In rupees
    if (amountToCharge <= 0) {
      throw new BadRequestError("Invalid plan amount for purchase.");
    }

    // Create Razorpay Order
    const amountInPaise = Math.round(amountToCharge * 100);

    const rzpOrder = await getRazorpayInstance().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `buy_rcpt_${Date.now()}`,
    });
    // Store Payment as PENDING in DB
    const payment = new Payment();
    payment.memberId = member._id;
    payment.planId = plan._id;
    payment.amount = amountToCharge;
    payment.paymentMethod = "razorpay";
    payment.transactionId = rzpOrder.id; // Using RZP Order ID for tracking
    payment.status = "PENDING";
    payment.isDeleted = false;
    payment.action = "buy";
    if (activeSub && activeSub.planId) {
      payment.previousPlanId = new ObjectId(activeSub.planId);
    }
    await this.paymentRepo.save(payment);

    return {
      razorpayOrderId: rzpOrder.id,
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID || "",
    };
  }

  private validateDowngradeConstraints(currentPlanTitle: string, newPlanTitle: string, startDate: Date) {
    const currentLower = currentPlanTitle.toLowerCase();
    const newLower = newPlanTitle.toLowerCase();

    // 1. Block Premium to Basic directly
    if (currentLower === "premium" && newLower === "basic") {
      throw new BadRequestError("Direct downgrade from Premium to Basic is not allowed. You must first downgrade to Standard.");
    }

    // 2. Block Standard to Basic if stayed less than 30 days (1 month)
    if (currentLower === "standard" && newLower === "basic") {
      const daysElapsed = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysElapsed < 30) {
        const remaining = Math.ceil(30 - daysElapsed);
        throw new BadRequestError(`You must stay on the Standard plan for at least 30 days before downgrading to Basic. (Days remaining: ${remaining})`);
      }
    }
  }

  async getDowngradeBreakdown(memberId: string, newPlanId: string) {
    const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
    if (!member) throw new NotFoundError("Member not found");

    const newPlan = await this.planRepo.findOneBy({ _id: new ObjectId(newPlanId), isDeleted: false });
    if (!newPlan) throw new NotFoundError("Selected plan not found");

    const activeSub = await this.subService.getActiveSubscription(memberId);
    if (!activeSub || !activeSub.subscriptionId || activeSub.isTrial) {
      throw new BadRequestError("You do not have an active paid subscription to downgrade.");
    }

    const currentPlan = await this.planRepo.findOneBy({ _id: activeSub.planId || new ObjectId("000000000000000000000000") });
    const currentPrice = currentPlan ? currentPlan.amount : 0;
    const currentPlanTitle = currentPlan ? currentPlan.title : "Unknown";

    if (newPlan.amount >= currentPrice) {
      throw new BadRequestError("Target plan must be a lower price tier for downgrading.");
    }

    // Validate constraints (Premium -> Basic direct block, Standard -> Basic 30-day block)
    this.validateDowngradeConstraints(currentPlanTitle, newPlan.title, activeSub.startDate);

    // Calculate remaining days of the current plan
    const timeRemaining = activeSub.endDate.getTime() - Date.now();
    const remainingDays = Math.max(0, timeRemaining / (1000 * 60 * 60 * 24));

    const currentCycle = currentPlan?.billingCycle || "yearly";
    const currentDaysInCycle = currentCycle === "monthly" ? 30 : 365;
    const currentPerDayCost = currentPrice / currentDaysInCycle;

    const newCycle = newPlan.billingCycle || "yearly";
    const newDaysInCycle = newCycle === "monthly" ? 30 : 365;
    const newPerDayCost = newPlan.amount > 0 ? (newPlan.amount / newDaysInCycle) : 0;

    // Calculate remaining unused balance from current plan and convert to days on new plan
    const remainingValue = remainingDays * currentPerDayCost;
    const newDurationDays = newPerDayCost > 0
      ? Math.max(0, Math.floor(remainingValue / newPerDayCost))
      : Math.max(0, Math.floor(remainingDays));

    const newEndDateObj = new Date(Date.now() + (newDurationDays * 1000 * 60 * 60 * 24));
    // Clean ISO date string without leading '+0' for 5-digit years
    const formattedEndDate = newEndDateObj.toISOString().replace(/^\+0+/, "");

    return {
      currentPlan: {
        id: currentPlan?._id.toString() || null,
        title: currentPlanTitle,
        amount: currentPrice,
      },
      newPlan: {
        id: newPlan._id.toString(),
        title: newPlan.title,
        amount: newPlan.amount,
      },
      remainingDays: Math.ceil(remainingDays),
      newDurationDays,
      newEndDate: formattedEndDate,
      newEndDateObj
    };
  }

  async executeDowngrade(memberId: string, newPlanId: string) {
    const breakdown = await this.getDowngradeBreakdown(memberId, newPlanId);

    const memberObjectId = new ObjectId(memberId);
    const planObjectId = new ObjectId(newPlanId);

    // 1. Expire current active subscriptions
    const subRepo = AppDataSource.getMongoRepository(MemberSubscription);
    await subRepo.updateMany(
      { memberId: memberObjectId, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    // 2. Create new MemberSubscription with translated prorated days
    const newSub = new MemberSubscription();
    newSub.memberId = memberObjectId;
    newSub.planId = planObjectId;

    const plan = await this.planRepo.findOneBy({ _id: planObjectId });
    newSub.type = plan?.type || "PREMIUM";
    newSub.status = "ACTIVE";
    newSub.startDate = new Date();
    newSub.endDate = breakdown.newEndDateObj || new Date(breakdown.newEndDate);
    newSub.isTrial = false;
    newSub.isDeleted = false;

    const savedSub = await subRepo.save(newSub);

    // 3. Update member subscriptionId and planId
    await this.memberRepo.update(memberObjectId, { subscriptionId: new ObjectId(savedSub._id), planId: new ObjectId(planObjectId) });

    // 4. Store a payment record of $0 for tracking
    const payment = new Payment();
    payment.memberId = memberObjectId;
    payment.planId = planObjectId;
    payment.amount = 0;
    payment.paymentMethod = "downgrade_credit";
    payment.transactionId = `downgrade_${Date.now()}`;
    payment.status = "COMPLETED";
    payment.subscriptionId = savedSub._id;
    payment.isDeleted = false;
    payment.action = "downgrade";
    if (breakdown.currentPlan && breakdown.currentPlan.id) {
      payment.previousPlanId = new ObjectId(breakdown.currentPlan.id);
    }
    await this.paymentRepo.save(payment);

    return {
      success: true,
      message: `Downgraded successfully to ${breakdown.newPlan.title}.`,
      data: {
        newPlan: breakdown.newPlan.title,
        newEndDate: breakdown.newEndDate,
        translatedDays: breakdown.newDurationDays,
        subscriptionId: savedSub._id.toString()
      }
    };
  }
}

export class RazorpayVerificationService {
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private subService = new SubscriptionService();

  async verifyUpgradePayment(razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string) {
    const razorpay = getRazorpayInstance();

    const paymentDetails = await razorpay.payments.fetch(razorpayPaymentId);

    console.log(paymentDetails);
    // 1. Signature validation using HMAC-SHA256
    const secret = process.env.RAZORPAY_KEY_SECRET || "";
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (generatedSignature !== razorpaySignature) {
      // Set payment status to FAILED
      const payment = await this.paymentRepo.findOneBy({ transactionId: razorpayOrderId });
      if (payment) {
        payment.status = "FAILED";
        await this.paymentRepo.save(payment);
      }
      throw new BadRequestError("Invalid payment signature. Verification failed.");
    }

    // 2. Fetch payment record
    const payment = await this.paymentRepo.findOneBy({ transactionId: razorpayOrderId });
    if (!payment) throw new BadRequestError("Payment record not found");

    if (payment.status === "COMPLETED") {
      return { success: true, message: "Payment already processed." };
    }

    // 3. Mark payment as completed
    payment.status = "COMPLETED";
    await this.paymentRepo.save(payment);

    // 4. Activate dynamic upgrade subscription
    const activeSub = await this.subService.activateSubscription(
      payment.memberId,
      payment.planId,
      payment._id
    );
    const member = await this.memberRepo.findOneBy({ _id: new ObjectId(payment.memberId) });
    if (!member) {
      throw new BadRequestError("Member not found");
    }
    await insertPushNotification({
      token: member.fcmToken || "",
      subject: "Plan Upgraded Successfully",
      content: "Congratulations! Your subscription plan has been upgraded successfully.",
      moduleName: NotificationModule.UPGRADE,
      moduleId: payment.planId.toString(),
      receiverId: member._id.toString()
    });

    return {
      success: true,
      message: "Subscription upgraded successfully",
      subscriptionId: activeSub._id,
    };
  }
}
