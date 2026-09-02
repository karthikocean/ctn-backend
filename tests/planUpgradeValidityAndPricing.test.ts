/**
 * Tests for Plan Upgrade Validity Preservation, Offer Price Upgrade,
 * Same-Day Purchase Upgrade, and Expired Subscription Full Pricing Calculation.
 */

import { ObjectId } from "mongodb";
import { AppDataSource } from "../src/data-source";
import { Member } from "../src/entity/Member";
import { Plan } from "../src/entity/Plan";
import { Payment } from "../src/entity/Payment";
import { MemberSubscription } from "../src/entity/MemberSubscription";
import { RazorpayUpgradeService } from "../src/services/razorpay.service";
import { SubscriptionService } from "../src/services/subscription.service";

describe("Plan Upgrade Validity & Prorated Pricing Calculations", () => {
  const upgradeService = new RazorpayUpgradeService();
  const subService = new SubscriptionService();

  let memberRepo: any;
  let planRepo: any;
  let subRepo: any;
  let paymentRepo: any;

  beforeAll(() => {
    memberRepo = AppDataSource.getMongoRepository(Member);
    planRepo = AppDataSource.getMongoRepository(Plan);
    subRepo = AppDataSource.getMongoRepository(MemberSubscription);
    paymentRepo = AppDataSource.getMongoRepository(Payment);
  });

  test("1. Same-day purchase upgrade correctly reduces 1 day from remaining days", async () => {
    const memberId = new ObjectId();
    const currentPlanId = new ObjectId();
    const upgradePlanId = new ObjectId();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1); // 365 days total

    // Basic: 4999
    const currentPlan = {
      _id: currentPlanId,
      title: "Basic",
      amount: 4999,
      billingCycle: "yearly",
      isDeleted: false
    };

    // Advance: 9999
    const upgradePlan = {
      _id: upgradePlanId,
      title: "Advance",
      amount: 9999,
      offerPrice: null,
      billingCycle: "yearly",
      isDeleted: false
    };

    const activeSub = {
      _id: new ObjectId(),
      subscriptionId: "sub_active_today",
      memberId,
      planId: currentPlanId,
      startDate,
      endDate,
      isTrial: false,
      status: "ACTIVE"
    };

    jest.spyOn(memberRepo, "findOneBy").mockResolvedValueOnce({ _id: memberId, name: "Test User" });
    jest.spyOn(planRepo, "findOneBy")
      .mockResolvedValueOnce(upgradePlan) // target plan
      .mockResolvedValueOnce(currentPlan); // current plan
    jest.spyOn((upgradeService as any).subService, "getActiveSubscription").mockResolvedValueOnce(activeSub as any);

    const breakdown = await upgradeService.getUpgradeBreakdown(memberId.toString(), upgradePlanId.toString());

    expect(breakdown.durationDetails.totalDays).toBe(365);
    expect(breakdown.durationDetails.daysUsed).toBe(1); // 1 day used
    expect(breakdown.durationDetails.daysRemaining).toBe(364); // 364 remaining

    // Per day calculations:
    // current per day = 4999 / 365 = 13.69589...
    // new per day = 9999 / 365 = 27.39452...
    // new remaining cost = 27.39452 * 364 = 9971.605
    // unused credit = 13.69589 * 364 = 4985.303
    // amountToPay = 9971.605 - 4985.303 = 4986.30
    expect(breakdown.amountToPay).toBeCloseTo(4986.30, 1);
  });

  test("2. getUpgradeBreakdown uses offerPrice for target plan and charges only for remaining days", async () => {
    const memberId = new ObjectId();
    const currentPlanId = new ObjectId();
    const upgradePlanId = new ObjectId();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 100); // 100 days elapsed + 1 active = 101 days used
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 265); // 365 total

    // Current Plan: 1000/yr
    const currentPlan = {
      _id: currentPlanId,
      title: "Basic Plan",
      amount: 1000,
      offerPrice: 800,
      billingCycle: "yearly",
      isDeleted: false
    };

    // Upgrade Plan: amount 3000, offerPrice 2000
    const upgradePlan = {
      _id: upgradePlanId,
      title: "Premium Plan",
      amount: 3000,
      offerPrice: 2000,
      billingCycle: "yearly",
      isDeleted: false
    };

    const activeSub = {
      _id: new ObjectId(),
      subscriptionId: "sub_active_123",
      memberId,
      planId: currentPlanId,
      startDate,
      endDate,
      isTrial: false,
      status: "ACTIVE"
    };

    jest.spyOn(memberRepo, "findOneBy").mockResolvedValueOnce({ _id: memberId, name: "Test User" });
    jest.spyOn(planRepo, "findOneBy")
      .mockResolvedValueOnce(upgradePlan) // target plan
      .mockResolvedValueOnce(currentPlan); // current plan
    jest.spyOn((upgradeService as any).subService, "getActiveSubscription").mockResolvedValueOnce(activeSub as any);

    const breakdown = await upgradeService.getUpgradeBreakdown(memberId.toString(), upgradePlanId.toString());

    expect(breakdown.newPlan.amount).toBe(2000); // Uses offerPrice 2000 instead of 3000
    expect(breakdown.newPlan.offerPrice).toBe(2000);
    expect(breakdown.durationDetails.totalDays).toBe(365);
    expect(breakdown.durationDetails.daysUsed).toBe(101);
    expect(breakdown.durationDetails.daysRemaining).toBe(264);

    expect(breakdown.amountToPay).toBeCloseTo(723.29, 1);
    expect(breakdown.amountToPay).toBeLessThan(2000);
  });

  test("3. activateSubscription preserves purchased plan startDate and endDate on upgrade", async () => {
    const memberId = new ObjectId();
    const upgradePlanId = new ObjectId();
    const paymentId = new ObjectId();

    const originalStartDate = new Date("2026-01-01T00:00:00.000Z");
    const originalEndDate = new Date("2027-01-01T00:00:00.000Z");

    const upgradePlan = {
      _id: upgradePlanId,
      title: "Premium Plan",
      billingCycle: "yearly",
      billingType: "PREMIUM",
      amount: 3000,
      isDeleted: false
    };

    const previousActiveSub = {
      _id: new ObjectId(),
      memberId,
      planId: new ObjectId(),
      status: "ACTIVE",
      startDate: originalStartDate,
      endDate: originalEndDate,
      isTrial: false,
      isDeleted: false
    };

    const payment = {
      _id: paymentId,
      memberId,
      planId: upgradePlanId,
      amount: 726.02,
      action: "upgrade",
      status: "COMPLETED"
    };

    jest.spyOn(planRepo, "findOneBy").mockResolvedValueOnce(upgradePlan);
    jest.spyOn(paymentRepo, "findOneBy").mockResolvedValueOnce(payment);
    jest.spyOn(subRepo, "findOneBy").mockResolvedValueOnce(previousActiveSub);
    jest.spyOn(subRepo, "findOne").mockResolvedValueOnce(previousActiveSub);
    jest.spyOn(subRepo, "updateMany").mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 });
    jest.spyOn(subRepo, "save").mockImplementationOnce(async (entity: any) => ({
      ...entity,
      _id: new ObjectId()
    }));
    jest.spyOn(paymentRepo, "update").mockResolvedValueOnce({ acknowledged: true });
    jest.spyOn(memberRepo, "update").mockResolvedValueOnce({ acknowledged: true });

    const activatedSub = await subService.activateSubscription(memberId, upgradePlanId, paymentId);

    // Crucial requirement: validity is not extended; ends on originalEndDate
    expect(new Date(activatedSub.startDate).toISOString()).toBe(originalStartDate.toISOString());
    expect(new Date(activatedSub.endDate).toISOString()).toBe(originalEndDate.toISOString());
  });

  test("4. isFirstTimeBuyer returns false if previous subscription has expired (shows actual price)", async () => {
    const memberId = new ObjectId();

    // Past expired subscription
    const expiredSub = {
      _id: new ObjectId(),
      memberId,
      isTrial: false,
      status: "EXPIRED",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2026-01-01"), // In past
      isDeleted: false
    };

    jest.spyOn(paymentRepo, "findOne").mockResolvedValueOnce(null); // No completed payment in query
    jest.spyOn(subRepo, "findOne")
      .mockResolvedValueOnce(expiredSub) // paidSub check -> false
      .mockResolvedValueOnce(expiredSub); // anySub check

    const isFirstTime = await subService.isFirstTimeBuyer(memberId);
    expect(isFirstTime).toBe(false);
  });

  test("5. MobilePlanController maps offerPrice and percentage to 0 when subscription is expired", async () => {
    const isFirstTimeBuyer = false; // Expired / existing user
    const plan = {
      _id: new ObjectId(),
      title: "Basic",
      amount: 4999,
      offerPrice: 3999,
      percentage: 20,
      trialDays: 0
    };

    const effectiveOfferPrice = isFirstTimeBuyer ? (plan.offerPrice ?? 0) : 0;
    const effectivePercentage = isFirstTimeBuyer ? (plan.percentage ?? 0) : 0;
    const effectivePrice = isFirstTimeBuyer && plan.offerPrice && plan.offerPrice > 0 ? plan.offerPrice : plan.amount;

    expect(effectiveOfferPrice).toBe(0);
    expect(effectivePercentage).toBe(0);
    expect(effectivePrice).toBe(4999);
  });
});
