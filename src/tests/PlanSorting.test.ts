import { AppDataSource } from "../data-source";
import { Plan } from "../entity/Plan";

describe("Plan Sorting and CRUD Tests", () => {
  let planRepo: any;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    planRepo = AppDataSource.getMongoRepository(Plan);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("should create, sort, and retrieve plans correctly", async () => {
    // 1. Clean up any existing test plans
    await planRepo.deleteMany({ title: { $regex: "^TEST_PLAN_", $options: "i" } });

    // 2. Insert test plans with specified sort orders and dates
    const p1 = planRepo.create({
      title: "TEST_PLAN_C",
      amount: 100,
      sort: 3,
      billingType: "basic",
      modules: [],
      features: { monthlyMeeting: false, eventVisitor: false, eventStall: false, spotlights: false },
      benefits: { requirementResponseLimit: 5, pointMultiplier: 1, trainingDiscountPercentage: 0, referralBonusMonths: 0 },
      isDeleted: false
    });

    const p2 = planRepo.create({
      title: "TEST_PLAN_A",
      amount: 150,
      sort: 1,
      billingType: "basic",
      modules: [],
      features: { monthlyMeeting: false, eventVisitor: false, eventStall: false, spotlights: false },
      benefits: { requirementResponseLimit: 5, pointMultiplier: 1, trainingDiscountPercentage: 0, referralBonusMonths: 0 },
      isDeleted: false
    });

    const p3 = planRepo.create({
      title: "TEST_PLAN_B",
      amount: 200,
      sort: 2,
      billingType: "basic",
      modules: [],
      features: { monthlyMeeting: false, eventVisitor: false, eventStall: false, spotlights: false },
      benefits: { requirementResponseLimit: 5, pointMultiplier: 1, trainingDiscountPercentage: 0, referralBonusMonths: 0 },
      isDeleted: false
    });

    // We will save them
    await planRepo.save([p1, p2, p3]);

    // 3. Retrieve and verify sort order (should be A (sort=1), B (sort=2), C (sort=3))
    const [plans, total] = await planRepo.findAndCount({
      where: {
        title: { $regex: "^TEST_PLAN_", $options: "i" },
        isDeleted: false
      },
      order: { sort: "ASC", createdAt: "DESC" }
    });

    expect(total).toBe(3);
    expect(plans[0].title).toBe("TEST_PLAN_A");
    expect(plans[1].title).toBe("TEST_PLAN_B");
    expect(plans[2].title).toBe("TEST_PLAN_C");

    // 4. Update sort order of TEST_PLAN_C to be 0 (should now be first)
    const planC = plans.find((p: any) => p.title === "TEST_PLAN_C");
    planC.sort = 0;
    await planRepo.save(planC);

    const updatedPlans = await planRepo.find({
      where: {
        title: { $regex: "^TEST_PLAN_", $options: "i" },
        isDeleted: false
      },
      order: { sort: "ASC", createdAt: "DESC" }
    });

    expect(updatedPlans[0].title).toBe("TEST_PLAN_C");
    expect(updatedPlans[1].title).toBe("TEST_PLAN_A");
    expect(updatedPlans[2].title).toBe("TEST_PLAN_B");

    // 5. Clean up
    await planRepo.deleteMany({ title: { $regex: "^TEST_PLAN_", $options: "i" } });
  });
});
