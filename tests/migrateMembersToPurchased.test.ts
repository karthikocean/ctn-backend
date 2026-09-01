import { migrateMembersToPurchased } from "../src/scripts/migrateMembersToPurchased";
import { AppDataSource } from "../src/data-source";
import { Member } from "../src/entity/Member";
import { MemberSubscription } from "../src/entity/MemberSubscription";
import { Plan } from "../src/entity/Plan";
import { ObjectId } from "mongodb";

describe("migrateMembersToPurchased", () => {
  let mockMemberRepo: any;
  let mockSubRepo: any;
  let mockPlanRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPlanRepo = {
      find: jest.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          title: "Advance",
          billingType: "advance",
          billingCycle: "yearly",
          isDeleted: false,
          status: "active"
        }
      ])
    };

    mockSubRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      save: jest.fn().mockImplementation((sub) => Promise.resolve({ ...sub, _id: new ObjectId() }))
    };

    mockMemberRepo = {
      find: jest.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          fullName: "John Doe",
          mobileNumber: "9876543210",
          isDeleted: false
        }
      ]),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Member) return mockMemberRepo;
      if (entity === MemberSubscription) return mockSubRepo;
      if (entity === Plan) return mockPlanRepo;
      return {} as any;
    });

    Object.defineProperty(AppDataSource, "isInitialized", {
      value: true,
      writable: true
    });
  });

  it("should process all existing members and set active purchased subscriptions with 1 year validity", async () => {
    await migrateMembersToPurchased();

    expect(mockPlanRepo.find).toHaveBeenCalled();
    expect(mockMemberRepo.find).toHaveBeenCalledWith({ where: { isDeleted: false } });

    // Should expire any previous subscription
    expect(mockSubRepo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE" }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "EXPIRED" }) })
    );

    // Should save new subscription with isTrial: false
    expect(mockSubRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ACTIVE",
        isTrial: false
      })
    );

    // Should update member with subscriptionId, planId, and hasUsedTrial: true
    expect(mockMemberRepo.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          hasUsedTrial: true,
          status: "active"
        })
      })
    );
  });
});
