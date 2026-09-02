/**
 * Tests for Plan Downgrade & Tier Resolution (P1-9)
 */

import { ObjectId } from "mongodb";
import { RazorpayUpgradeService } from "../src/services/razorpay.service";
import { AppDataSource } from "../src/data-source";
import { Plan } from "../src/entity/Plan";

describe("Plan Downgrade & Tier Resolution Security (P1-9)", () => {
  let upgradeService: RazorpayUpgradeService;

  beforeEach(() => {
    upgradeService = new RazorpayUpgradeService();
    jest.clearAllMocks();
  });

  test("1. Blocks direct downgrade from Premium/Ultimate tier to Basic even when display titles are customized", async () => {
    const memberId = new ObjectId().toString();
    const currentPlanId = new ObjectId();
    const newPlanId = new ObjectId();

    // Custom display titles that do NOT contain the words 'Premium' or 'Basic'
    const currentPlan = {
      _id: currentPlanId,
      title: "Executive Diamond Tier 2026",
      billingType: "ultimate", // Stable identifier for Premium
      amount: 19999,
      billingCycle: "yearly",
      isDeleted: false
    } as unknown as Plan;

    const newPlan = {
      _id: newPlanId,
      title: "Starter Package",
      billingType: "basic", // Stable identifier for Basic
      amount: 4999,
      billingCycle: "yearly",
      isDeleted: false
    } as unknown as Plan;

    const activeSub = {
      subscriptionId: new ObjectId(),
      planId: currentPlanId,
      startDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
      endDate: new Date(Date.now() + 325 * 24 * 60 * 60 * 1000),
      isTrial: false
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Member") {
        return { findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(memberId) }) } as any;
      }
      if (entity.name === "Plan") {
        return {
          findOneBy: jest.fn().mockImplementation((criteria: any) => {
            if (criteria._id?.toString() === newPlanId.toString()) return Promise.resolve(newPlan);
            if (criteria._id?.toString() === currentPlanId.toString()) return Promise.resolve(currentPlan);
            return Promise.resolve(null);
          })
        } as any;
      }
      return {} as any;
    });

    jest.spyOn((upgradeService as any).subService, "getActiveSubscription").mockResolvedValue(activeSub);

    // Attempting to downgrade from Executive Diamond (ultimate) to Starter (basic) must be blocked
    await expect(upgradeService.getDowngradeBreakdown(memberId, newPlanId.toString())).rejects.toThrow(
      "Direct downgrade from Premium to Basic is not allowed. You must first downgrade to Standard."
    );
  });

  test("2. Blocks downgrade from Standard/Advance to Basic if member has been on Standard for < 30 days", async () => {
    const memberId = new ObjectId().toString();
    const currentPlanId = new ObjectId();
    const newPlanId = new ObjectId();

    const currentPlan = {
      _id: currentPlanId,
      title: "Silver Growth Plan",
      billingType: "advance", // Stable identifier for Standard
      amount: 9999,
      billingCycle: "yearly",
      isDeleted: false
    } as unknown as Plan;

    const newPlan = {
      _id: newPlanId,
      title: "Starter Package",
      billingType: "basic",
      amount: 4999,
      billingCycle: "yearly",
      isDeleted: false
    } as unknown as Plan;

    const activeSub = {
      subscriptionId: new ObjectId(),
      planId: currentPlanId,
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Only 10 days on Standard
      endDate: new Date(Date.now() + 355 * 24 * 60 * 60 * 1000),
      isTrial: false
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Member") {
        return { findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(memberId) }) } as any;
      }
      if (entity.name === "Plan") {
        return {
          findOneBy: jest.fn().mockImplementation((criteria: any) => {
            if (criteria._id?.toString() === newPlanId.toString()) return Promise.resolve(newPlan);
            if (criteria._id?.toString() === currentPlanId.toString()) return Promise.resolve(currentPlan);
            return Promise.resolve(null);
          })
        } as any;
      }
      return {} as any;
    });

    jest.spyOn((upgradeService as any).subService, "getActiveSubscription").mockResolvedValue(activeSub);

    await expect(upgradeService.getDowngradeBreakdown(memberId, newPlanId.toString())).rejects.toThrow(
      /You must stay on the Standard plan for at least 30 days before downgrading to Basic/
    );
  });

  test("3. Allows downgrade from Standard/Advance to Basic if member has been on Standard for >= 30 days", async () => {
    const memberId = new ObjectId().toString();
    const currentPlanId = new ObjectId();
    const newPlanId = new ObjectId();

    const currentPlan = {
      _id: currentPlanId,
      title: "Silver Growth Plan",
      billingType: "advance",
      amount: 9999,
      billingCycle: "yearly",
      isDeleted: false
    } as unknown as Plan;

    const newPlan = {
      _id: newPlanId,
      title: "Starter Package",
      billingType: "basic",
      amount: 4999,
      billingCycle: "yearly",
      isDeleted: false
    } as unknown as Plan;

    const activeSub = {
      subscriptionId: new ObjectId(),
      planId: currentPlanId,
      startDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days on Standard
      endDate: new Date(Date.now() + 330 * 24 * 60 * 60 * 1000),
      isTrial: false
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Member") {
        return { findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(memberId) }) } as any;
      }
      if (entity.name === "Plan") {
        return {
          findOneBy: jest.fn().mockImplementation((criteria: any) => {
            if (criteria._id?.toString() === newPlanId.toString()) return Promise.resolve(newPlan);
            if (criteria._id?.toString() === currentPlanId.toString()) return Promise.resolve(currentPlan);
            return Promise.resolve(null);
          })
        } as any;
      }
      return {} as any;
    });

    jest.spyOn((upgradeService as any).subService, "getActiveSubscription").mockResolvedValue(activeSub);

    const breakdown = await upgradeService.getDowngradeBreakdown(memberId, newPlanId.toString());

    expect(breakdown).toBeDefined();
    expect(breakdown.newPlan.id).toBe(newPlanId.toString());
    expect(breakdown.newDurationDays).toBeGreaterThan(0);
  });
});
