import { getDashboardDateRange, AdminDashboardController } from "../src/controllers/admin/DashboardController";
import { Member, MemberStatus } from "../src/entity/Member";
import { PostModel, PostType } from "../src/entity/Post";
import { OneToOne } from "../src/entity/OneToOne";
import { Referral } from "../src/entity/Referral";
import { ThankYouSlip } from "../src/entity/ThankYouSlip";
import { Training } from "../src/entity/Training";
import { MemberTraining } from "../src/entity/MemberTraining";
import { MemberSubscription } from "../src/entity/MemberSubscription";
import { BusinessRegion } from "../src/entity/BusinessRegion";
import { State } from "../src/entity/State";
import { Category } from "../src/entity/Category";
import { AppDataSource } from "../src/data-source";
import { ObjectId } from "mongodb";

describe("Dashboard Controller & Date Range Utilities", () => {
  describe("getDashboardDateRange", () => {
    it("should calculate correct date range for 'today' preset", () => {
      const { startDate, endDate } = getDashboardDateRange("today");
      expect(startDate).not.toBeNull();
      const now = new Date();
      expect(startDate?.getDate()).toBe(now.getDate());
      expect(startDate?.getHours()).toBe(0);
      expect(endDate.getHours()).toBe(23);
    });

    it("should calculate correct date range for 'this_month' preset", () => {
      const { startDate, endDate } = getDashboardDateRange("this_month");
      expect(startDate).not.toBeNull();
      expect(startDate?.getDate()).toBe(1);
      expect(endDate.getHours()).toBe(23);
    });

    it("should return null startDate for 'all_time' preset", () => {
      const { startDate, endDate } = getDashboardDateRange("all_time");
      expect(startDate).toBeNull();
      expect(endDate).toBeInstanceOf(Date);
    });

    it("should parse custom startDate and endDate strings correctly", () => {
      const customStart = "2026-08-01";
      const customEnd = "2026-08-15";
      const { startDate, endDate } = getDashboardDateRange(undefined, customStart, customEnd);
      expect(startDate?.getFullYear()).toBe(2026);
      expect(startDate?.getMonth()).toBe(7); // August is month index 7
      expect(startDate?.getDate()).toBe(1);
      expect(endDate.getDate()).toBe(15);
    });
  });

  describe("AdminDashboardController - getDashboardStats & Charts", () => {
    let controller: AdminDashboardController;
    let mockRes: any;
    let mockReq: any;

    let mockMemberRepo: any;
    let mockPostRepo: any;
    let mockOneToOneRepo: any;
    let mockReferralRepo: any;
    let mockThankYouSlipRepo: any;
    let mockTrainingRepo: any;
    let mockMemberTrainingRepo: any;
    let mockMemberSubscriptionRepo: any;
    let mockRegionRepo: any;
    let mockStateRepo: any;
    let mockCategoryRepo: any;

    beforeEach(() => {
      mockMemberRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockPostRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockOneToOneRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockReferralRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockThankYouSlipRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockTrainingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockMemberTrainingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockMemberSubscriptionRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockRegionRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockStateRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };
      mockCategoryRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() };

      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity === Member) return mockMemberRepo;
        if (entity === PostModel) return mockPostRepo;
        if (entity === OneToOne) return mockOneToOneRepo;
        if (entity === Referral) return mockReferralRepo;
        if (entity === ThankYouSlip) return mockThankYouSlipRepo;
        if (entity === Training) return mockTrainingRepo;
        if (entity === MemberTraining) return mockMemberTrainingRepo;
        if (entity === MemberSubscription) return mockMemberSubscriptionRepo;
        if (entity === BusinessRegion) return mockRegionRepo;
        if (entity === State) return mockStateRepo;
        if (entity === Category) return mockCategoryRepo;
        return { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), count: jest.fn() } as any;
      });

      controller = new AdminDashboardController();

      mockReq = {
        isFranchise: false,
        franchiseAreaIds: []
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return correct 16 metric counts and chart datasets", async () => {
      const m1Oid = new ObjectId();
      const m2Oid = new ObjectId();
      const m3Oid = new ObjectId();

      const mockMembers: any[] = [
        {
          _id: m1Oid,
          fullName: "User 1",
          status: MemberStatus.ACTIVE,
          isDeleted: false,
          subscriptionEndDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        },
        {
          _id: m2Oid,
          fullName: "User 2",
          status: MemberStatus.ACTIVE,
          isDeleted: false,
          subscriptionEndDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        },
        {
          _id: m3Oid,
          fullName: "User 3",
          status: MemberStatus.INACTIVE,
          isDeleted: false,
          subscriptionEndDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        }
      ];

      const mockPosts: any[] = [
        { _id: new ObjectId(), memberId: m1Oid, type: PostType.PROMOTION, isDeleted: false, createdAt: new Date() },
        { _id: new ObjectId(), memberId: m1Oid, type: PostType.ASK, isDeleted: false, createdAt: new Date() },
        { _id: new ObjectId(), memberId: m2Oid, type: PostType.GIVE, isDeleted: false, createdAt: new Date() },
        { _id: new ObjectId(), memberId: m2Oid, type: PostType.REQUIREMENT, isDeleted: false, createdAt: new Date() }
      ];

      const mockOneToOnes: any[] = [
        { _id: new ObjectId(), senderId: m1Oid, receiverId: m2Oid, createdAt: new Date() }
      ];

      const mockReferrals: any[] = [
        { _id: new ObjectId(), senderId: m1Oid, receiverId: m2Oid, createdAt: new Date() },
        { _id: new ObjectId(), senderId: m2Oid, receiverId: m1Oid, createdAt: new Date() }
      ];

      const mockThankYouSlips: any[] = [
        { _id: new ObjectId(), senderId: m1Oid, receiverId: m2Oid, amount: 5000, createdAt: new Date() },
        { _id: new ObjectId(), senderId: m2Oid, receiverId: m1Oid, amount: 15000, createdAt: new Date() }
      ];

      const mockTrainings: any[] = [
        { _id: new ObjectId(), title: "Sales 101", isDeleted: false, createdAt: new Date() }
      ];
      const mockMemberTrainings: any[] = [
        { _id: new ObjectId(), memberId: m1Oid, createdAt: new Date() }
      ];
      const mockSubscriptions: any[] = [
        { _id: new ObjectId(), memberId: m1Oid, isTrial: false, isDeleted: false },
        { _id: new ObjectId(), memberId: m2Oid, isTrial: false, isDeleted: false }
      ];
      const mockRegions: any[] = [
        { _id: new ObjectId(), state: new ObjectId(), isDeleted: false }
      ];
      const mockStates: any[] = [
        { _id: new ObjectId(), name: "Maharashtra", isDeleted: false }
      ];
      const mockCategories: any[] = [
        { _id: new ObjectId(), name: "Trading", isDeleted: false }
      ];

      mockMemberRepo.find.mockResolvedValue(mockMembers);
      mockPostRepo.find.mockResolvedValue(mockPosts);
      mockOneToOneRepo.find.mockResolvedValue(mockOneToOnes);
      mockReferralRepo.find.mockResolvedValue(mockReferrals);
      mockThankYouSlipRepo.find.mockResolvedValue(mockThankYouSlips);
      mockTrainingRepo.find.mockResolvedValue(mockTrainings);
      mockMemberTrainingRepo.find.mockResolvedValue(mockMemberTrainings);
      mockMemberSubscriptionRepo.find.mockResolvedValue(mockSubscriptions);
      mockRegionRepo.find.mockResolvedValue(mockRegions);
      mockStateRepo.find.mockResolvedValue(mockStates);
      mockCategoryRepo.find.mockResolvedValue(mockCategories);

      await controller.getDashboardStats(
        mockReq,
        "today",
        "",
        "",
        "",
        "",
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const responseData = mockRes.json.mock.calls[0][0];
      expect(responseData.success).toBe(true);
      expect(responseData.data.totalMembers).toBe(3);
      expect(responseData.data.charts).toBeDefined();
      expect(Array.isArray(responseData.data.charts.trainingTrend)).toBe(true);
      expect(responseData.data.charts.trainingTrend.length).toBe(7);
      expect(Array.isArray(responseData.data.charts.membersTrend)).toBe(true);
      expect(responseData.data.charts.membersTrend.length).toBe(7);
      expect(Array.isArray(responseData.data.charts.regionOverview)).toBe(true);
      expect(Array.isArray(responseData.data.charts.categoryOverview)).toBe(true);
    });
  });
});
