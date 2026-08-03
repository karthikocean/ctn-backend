import { getDashboardDateRange, AdminDashboardController } from "../src/controllers/admin/DashboardController";
import { MemberStatus } from "../src/entity/Member";
import { PostType } from "../src/entity/Post";
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

    beforeEach(() => {
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

      // Mocks for charts
      const mockTrainings: any[] = [
        { _id: new ObjectId(), title: "Sales 101", isDeleted: false, createdAt: new Date() }
      ];
      const mockMemberTrainings: any[] = [
        { _id: new ObjectId(), memberId: m1Oid, createdAt: new Date() }
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

      (controller as any).memberRepo = { find: jest.fn().mockResolvedValue(mockMembers) };
      (controller as any).postRepo = { find: jest.fn().mockResolvedValue(mockPosts) };
      (controller as any).oneToOneRepo = { find: jest.fn().mockResolvedValue(mockOneToOnes) };
      (controller as any).referralRepo = { find: jest.fn().mockResolvedValue(mockReferrals) };
      (controller as any).thankYouSlipRepo = { find: jest.fn().mockResolvedValue(mockThankYouSlips) };
      (controller as any).trainingRepo = { find: jest.fn().mockResolvedValue(mockTrainings) };
      (controller as any).memberTrainingRepo = { find: jest.fn().mockResolvedValue(mockMemberTrainings) };
      (controller as any).regionRepo = { find: jest.fn().mockResolvedValue(mockRegions) };
      (controller as any).stateRepo = { find: jest.fn().mockResolvedValue(mockStates) };
      (controller as any).categoryRepo = { find: jest.fn().mockResolvedValue(mockCategories) };

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
