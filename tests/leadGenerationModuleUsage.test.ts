import { ObjectId } from "mongodb";
import { AppDataSource } from "../src/data-source";
import { SubscriptionService } from "../src/services/subscription.service";
import { validateModuleUsage, validateLeadGenerationLimit, getRemainingUsage } from "../src/services/moduleUsage.service";
import { BadRequestError } from "routing-controllers";

describe("Lead Generation Module Usage & Benefits Validation", () => {
  let subscriptionService: SubscriptionService;

  const userPlan: any = {
    _id: new ObjectId("6a9e7933a8f7035ee5d77fdf"),
    trialDays: 120,
    status: "active",
    billingCycle: "yearly",
    sort: 2,
    title: "App Experience",
    description: "App Experience plan",
    amount: 1,
    percentage: 0,
    offerPrice: 1,
    modules: [
      {
        moduleName: "Ask",
        countLimit: 10,
        frequency: "monthly",
        frequencyValue: 1
      }
    ],
    billingType: "standard",
    features: {
      monthlyMeeting: true,
      eventVisitor: true,
      eventStall: true,
      spotlights: true,
      leadGeneration: true
    },
    benefits: {
      requirementResponseLimit: 10,
      pointMultiplier: 1,
      trainingDiscountPercentage: 0,
      referralBonusMonths: 0,
      leadGenerationCount: 1
    },
    isDeleted: false
  };

  const memberId = new ObjectId();
  const mockMember = {
    _id: memberId,
    planId: userPlan._id,
    subscriptionStartDate: new Date("2026-09-01"),
    subscriptionEndDate: new Date("2027-09-01"),
    isDeleted: false
  };

  let mockLeadRequestRepo: any;
  let mockMemberRepo: any;
  let mockPlanRepo: any;

  beforeEach(() => {
    subscriptionService = new SubscriptionService();

    mockLeadRequestRepo = {
      count: jest.fn().mockResolvedValue(0)
    };

    mockMemberRepo = {
      findOneBy: jest.fn().mockResolvedValue(mockMember)
    };

    mockPlanRepo = {
      findOneBy: jest.fn().mockResolvedValue(userPlan)
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "LeadGenerationRequest") {
        return mockLeadRequestRepo as any;
      }
      if (entity.name === "Member") {
        return mockMemberRepo as any;
      }
      if (entity.name === "Plan") {
        return mockPlanRepo as any;
      }
      return {} as any;
    });

    // Mock getMemberPlan to return userPlan
    jest.spyOn(subscriptionService, "getMemberPlan").mockResolvedValue(userPlan);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should succeed validation when member usage (0) is below leadGenerationCount (1)", async () => {
    mockLeadRequestRepo.count.mockResolvedValue(0);

    await expect(
      subscriptionService.validateLeadGenerationLimit(memberId)
    ).resolves.toBeUndefined();

    await expect(
      subscriptionService.validateModuleUsage(memberId, "Lead Generation")
    ).resolves.toBeUndefined();
  });

  it("should reject when member usage (1) reaches leadGenerationCount (1)", async () => {
    mockLeadRequestRepo.count.mockResolvedValue(1);

    await expect(
      subscriptionService.validateLeadGenerationLimit(memberId)
    ).rejects.toThrow(BadRequestError);

    await expect(
      subscriptionService.validateLeadGenerationLimit(memberId)
    ).rejects.toThrow(/Lead Generation limit of 1 request\(s\) reached/);
  });

  it("should reject if plan features has leadGeneration disabled (false)", async () => {
    const disabledPlan = {
      ...userPlan,
      features: {
        ...userPlan.features,
        leadGeneration: false
      }
    };
    jest.spyOn(subscriptionService, "getMemberPlan").mockResolvedValue(disabledPlan);

    await expect(
      subscriptionService.validateModuleUsage(memberId, "Lead Generation")
    ).rejects.toThrow(/Lead Generation is not enabled/);
  });

  it("should allow unlimited usage when leadGenerationCount is -1", async () => {
    const unlimitedPlan = {
      ...userPlan,
      benefits: {
        ...userPlan.benefits,
        leadGenerationCount: -1
      }
    };
    jest.spyOn(subscriptionService, "getMemberPlan").mockResolvedValue(unlimitedPlan);
    mockLeadRequestRepo.count.mockResolvedValue(50);

    await expect(
      subscriptionService.validateLeadGenerationLimit(memberId)
    ).resolves.toBeUndefined();
  });

  it("should validate using plan.modules when Lead Generation is configured as a module", async () => {
    const modulePlan = {
      ...userPlan,
      modules: [
        {
          moduleName: "Lead Generation",
          countLimit: 3,
          frequency: "monthly",
          frequencyValue: 1
        }
      ]
    };
    jest.spyOn(subscriptionService, "getMemberPlan").mockResolvedValue(modulePlan);

    mockLeadRequestRepo.count.mockResolvedValue(2);
    await expect(
      subscriptionService.validateLeadGenerationLimit(memberId)
    ).resolves.toBeUndefined();

    mockLeadRequestRepo.count.mockResolvedValue(3);
    await expect(
      subscriptionService.validateLeadGenerationLimit(memberId)
    ).rejects.toThrow(/limit reached/i);
  });

  it("should return remaining usage details for lead generation", async () => {
    mockLeadRequestRepo.count.mockResolvedValue(0);

    const remaining0 = await subscriptionService.getRemainingUsage(memberId, "Lead Generation");
    expect(remaining0).toEqual({
      moduleName: "Lead Generation",
      used: 0,
      limit: 1,
      remaining: 1,
      frequency: "daily"
    });

    mockLeadRequestRepo.count.mockResolvedValue(1);
    const remaining1 = await subscriptionService.getRemainingUsage(memberId, "Lead Generation");
    expect(remaining1).toEqual({
      moduleName: "Lead Generation",
      used: 1,
      limit: 1,
      remaining: 0,
      frequency: "daily"
    });
  });
});
