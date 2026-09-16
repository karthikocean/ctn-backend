import { MobileSubscriptionController } from "../src/controllers/mobile/SubscriptionController";
import { AppDataSource } from "../src/data-source";
import { ObjectId } from "mongodb";

describe("MobileSubscriptionController - getAnalytics (Issue #11)", () => {
  let controller: MobileSubscriptionController;
  let mockSubRepo: any;
  let mockPaymentRepo: any;
  let mockMemberRepo: any;

  const mockMemberId1 = new ObjectId("6a969fdd6f9832688a8a11ce");
  const mockMemberId2 = new ObjectId("6a969fdd6f9832688a8a11cf");

  beforeEach(() => {
    mockSubRepo = {
      count: jest.fn().mockImplementation((query: any) => {
        // Test query syntax: $or must be at the root of the query, NOT nested in a 'where' key
        if (query && query.where && query.where.$or) {
          throw new Error("unknown operator: $or");
        }
        if (query && query.$or) {
          return Promise.resolve(4); // trialUsers
        }
        if (query && query.type === "PREMIUM") {
          return Promise.resolve(2); // premiumUsers
        }
        if (query && query.status === "ACTIVE") {
          return Promise.resolve(6); // activeSubscribers
        }
        if (query && query.status === "EXPIRED") {
          return Promise.resolve(3); // expiredSubscribers
        }
        return Promise.resolve(0);
      }),
      find: jest.fn().mockResolvedValue([
        { memberId: mockMemberId1 },
        { memberId: mockMemberId2 }
      ])
    };

    mockPaymentRepo = {
      find: jest.fn().mockResolvedValue([
        { amount: 15000 },
        { amount: 25000 }
      ])
    };

    mockMemberRepo = {
      count: jest.fn().mockImplementation((query: any) => {
        if (query && query._id && query._id.$in) {
          // Converted count batch query
          return Promise.resolve(query._id.$in.length);
        }
        if (query && query.hasUsedTrial) {
          return Promise.resolve(5); // trialUsedCount
        }
        return Promise.resolve(0);
      }),
      findOneBy: jest.fn() // Must NOT be called (N+1 eliminated!)
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const name = entity?.name || entity?.toString();
      if (name === "MemberSubscription") return mockSubRepo;
      if (name === "Payment") return mockPaymentRepo;
      if (name === "Member") return mockMemberRepo;
      return {} as any;
    });

    controller = new MobileSubscriptionController();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should calculate analytics successfully without $or error and without N+1 queries", async () => {
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await controller.getAnalytics(mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const response = mockRes.json.mock.calls[0][0];

    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      trialUsers: 4,
      premiumUsers: 2,
      activeSubscribers: 6,
      expiredSubscribers: 3,
      totalRevenue: 40000,
      trialUsedCount: 5,
      convertedCount: 2,
      trialConversionRate: "40%" // (2 / 5) * 100 = 40%
    });

    // 1. Verify $or query was called without 'where' wrapper
    expect(mockSubRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [{ type: "TRIAL" }, { isTrial: true }],
        status: "ACTIVE",
        isDeleted: false
      })
    );

    // 2. Verify projections were applied
    expect(mockPaymentRepo.find).toHaveBeenCalledWith({
      where: { status: "COMPLETED", isDeleted: false },
      select: ["amount"]
    });

    expect(mockSubRepo.find).toHaveBeenCalledWith({
      where: {
        type: { $in: ["PREMIUM", "BUSINESS"] },
        isDeleted: false
      },
      select: ["memberId"]
    });

    // 3. Verify N+1 findOneBy was NEVER called
    expect(mockMemberRepo.findOneBy).not.toHaveBeenCalled();

    // 4. Verify batch member count was called with $in
    expect(mockMemberRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: [mockMemberId1, mockMemberId2] },
        hasUsedTrial: true,
        isDeleted: false
      })
    );
  });

  it("should handle empty data safely (zero subscriptions, payments, and members)", async () => {
    mockSubRepo.count.mockResolvedValue(0);
    mockSubRepo.find.mockResolvedValue([]);
    mockPaymentRepo.find.mockResolvedValue([]);
    mockMemberRepo.count.mockResolvedValue(0);

    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await controller.getAnalytics(mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const response = mockRes.json.mock.calls[0][0];

    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      trialUsers: 0,
      premiumUsers: 0,
      activeSubscribers: 0,
      expiredSubscribers: 0,
      totalRevenue: 0,
      trialUsedCount: 0,
      convertedCount: 0,
      trialConversionRate: "0%"
    });

    // Verify memberRepo.count for converted members was skipped because trialUsedCount === 0
    expect(mockMemberRepo.count).toHaveBeenCalledTimes(1); // Only for trialUsedCount
    expect(mockMemberRepo.findOneBy).not.toHaveBeenCalled();
  });

  it("should handle unexpected error gracefully via handleErrorResponse", async () => {
    mockSubRepo.count.mockRejectedValueOnce(new Error("Database connection failure"));

    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await controller.getAnalytics(mockRes);

    expect(mockRes.status).toHaveBeenCalled();
  });
});
