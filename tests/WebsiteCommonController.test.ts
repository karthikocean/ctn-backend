import { WebsiteCommonController } from "../src/controllers/website/CommonController";
import { AppDataSource } from "../src/data-source";
import { MemberStatus } from "../src/entity/Member";
import { CategoryType, CategoryStatus } from "../src/entity/Category";
import { BusinessRegionStatus } from "../src/entity/BusinessRegion";
import { PostType } from "../src/entity/Post";
import { ConnectionStatus } from "../src/entity/Connection";

describe("WebsiteCommonController - getWebsiteStats", () => {
  let controller: WebsiteCommonController;
  let mockMemberRepo: any;
  let mockCategoryRepo: any;
  let mockBusinessRegionRepo: any;
  let mockOneToOneRepo: any;
  let mockReferralRepo: any;
  let mockPostRepo: any;
  let mockTySlipRepo: any;
  let mockConnectionRepo: any;

  beforeEach(() => {
    mockMemberRepo = {
      count: jest.fn().mockResolvedValue(120)
    };

    mockCategoryRepo = {
      count: jest.fn().mockResolvedValue(25)
    };

    mockBusinessRegionRepo = {
      find: jest.fn().mockResolvedValue([
        { areas: ["Area 1", "Area 2", "Area 3"] },
        { areas: ["Area 4", "Area 5"] },
        { areas: null } // non-array fallback
      ])
    };

    mockOneToOneRepo = {
      count: jest.fn().mockResolvedValue(121)
    };

    mockReferralRepo = {
      count: jest.fn().mockResolvedValue(80)
    };

    mockPostRepo = {
      count: jest.fn().mockResolvedValue(60)
    };

    mockTySlipRepo = {
      find: jest.fn().mockResolvedValue([
        { amount: 5000000 },
        { amount: 3000000 },
        { amount: 2000000 }
      ])
    };

    mockConnectionRepo = {
      count: jest.fn().mockResolvedValue(350)
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const name = entity?.name || entity?.toString();
      if (name === "Member") return mockMemberRepo;
      if (name === "Category") return mockCategoryRepo;
      if (name === "BusinessRegion") return mockBusinessRegionRepo;
      if (name === "OneToOne") return mockOneToOneRepo;
      if (name === "Referral") return mockReferralRepo;
      if (name === "PostModel") return mockPostRepo;
      if (name === "ThankYouSlip") return mockTySlipRepo;
      if (name === "Connection") return mockConnectionRepo;
      return {} as any;
    });

    controller = new WebsiteCommonController();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should retrieve all stats concurrently with correct projections and calculations", async () => {
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await controller.getWebsiteStats(mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const response = mockRes.json.mock.calls[0][0];

    expect(response.success).toBe(true);
    expect(response.message).toBe("Website statistics retrieved successfully");

    // Check data counts
    expect(response.data.activeMembersCount).toBe(120);
    expect(response.data.categoryCount).toBe(25);
    expect(response.data.totalRegions).toBe(5); // 3 + 2 = 5
    expect(response.data.directMeetCount).toBe(121);
    expect(response.data.recommendationCount).toBe(80);
    expect(response.data.requirementsCount).toBe(60);
    expect(response.data.businessDoneCount).toBe(3);
    expect(response.data.businessDoneAmountRaw).toBe(10000000); // 10M
    expect(response.data.businessDoneAmount).toBe("10M");
    expect(response.data.businessAmount).toBe("10M");
    expect(response.data.activeFollowingCount).toBe(350);
    expect(response.data.totalFollowingCount).toBe(350);
    expect(response.data.followingCount).toBe(350);
    expect(response.data.followingCountFormatted).toBe("350");

    // Verify filter arguments & projections
    expect(mockMemberRepo.count).toHaveBeenCalledWith({
      isDeleted: false,
      status: MemberStatus.ACTIVE
    });

    expect(mockCategoryRepo.count).toHaveBeenCalledWith({
      isDeleted: false,
      status: CategoryStatus.ACTIVE,
      type: CategoryType.MAIN
    });

    expect(mockBusinessRegionRepo.find).toHaveBeenCalledWith({
      where: {
        isDeleted: false,
        status: BusinessRegionStatus.ACTIVE
      },
      select: ["areas"]
    });

    expect(mockOneToOneRepo.count).toHaveBeenCalledWith();
    expect(mockReferralRepo.count).toHaveBeenCalledWith();

    expect(mockPostRepo.count).toHaveBeenCalledWith({
      isDeleted: false,
      type: PostType.REQUIREMENT
    });

    expect(mockTySlipRepo.find).toHaveBeenCalledWith({
      select: ["amount"]
    });

    expect(mockConnectionRepo.count).toHaveBeenCalledWith({
      isDeleted: false,
      status: ConnectionStatus.ACCEPTED
    });
  });

  it("should handle error gracefully and invoke error handler", async () => {
    mockMemberRepo.count.mockRejectedValueOnce(new Error("Database connection lost"));

    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await controller.getWebsiteStats(mockRes);

    expect(mockRes.status).toHaveBeenCalled();
  });
});
