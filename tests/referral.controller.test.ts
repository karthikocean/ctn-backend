import { ObjectId } from "mongodb";
import { BadRequestError } from "routing-controllers";
import { MobileReferralController } from "../src/controllers/mobile/ReferralController";
import { MobileMemberController } from "../src/controllers/mobile/MemberController";
import { Member, MemberStatus } from "../src/entity/Member";
import { UserReferral, UserReferralStatus } from "../src/entity/UserReferral";

describe("Referral Controller & Registration Integration Tests", () => {
  let referralController: MobileReferralController;
  let memberController: MobileMemberController;
  let mockRes: any;

  beforeEach(() => {
    referralController = new MobileReferralController();
    memberController = new MobileMemberController();

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe("GET /mobile-api/referrals/me", () => {
    it("should return referral code, link and stats for authenticated member", async () => {
      const memberId = new ObjectId();
      const mockReq = {
        user: { userId: memberId.toString() }
      };

      const mockInfo = {
        referralCode: "ANBU8F42",
        referralLink: "https://trustednetwork.in/ref/ANBU8F42",
        totalReferrals: 10,
        successfulReferrals: 8,
        pendingReferrals: 2,
        totalRewards: 400
      };

      jest.spyOn((referralController as any).referralService, "getMyReferralInfo")
        .mockResolvedValueOnce(mockInfo);

      await referralController.getMyReferralInfo(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockInfo
      });
    });
  });

  describe("GET /mobile-api/referrals/history", () => {
    it("should return paginated list of referrals", async () => {
      const memberId = new ObjectId();
      const mockReq = {
        user: { userId: memberId.toString() }
      };

      const mockHistoryResult = {
        referrals: [
          {
            _id: new ObjectId(),
            referrerId: memberId,
            referredUserId: new ObjectId(),
            referralCode: "ANBU8F42",
            referrerReward: 50,
            status: UserReferralStatus.COMPLETED,
            referredUser: { fullName: "Jane Doe" }
          }
        ],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1 }
      };

      jest.spyOn((referralController as any).referralService, "getReferralHistory")
        .mockResolvedValueOnce(mockHistoryResult);

      await referralController.getReferralHistory(mockReq, { page: 1, limit: 20 }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockHistoryResult.referrals,
        pagination: mockHistoryResult.pagination
      });
    });
  });

  describe("POST /mobile-api/referrals/apply", () => {
    it("should successfully apply referral code if member has no referrer", async () => {
      const memberId = new ObjectId();
      const mockReq = {
        user: { userId: memberId.toString() }
      };

      const mockMember: Member = {
        _id: memberId,
        fullName: "Test Member",
        referredBy: undefined,
        isDeleted: false
      } as any;

      jest.spyOn((referralController as any).memberRepo, "findOneBy")
        .mockResolvedValueOnce(mockMember);

      jest.spyOn((referralController as any).referralService, "processReferral")
        .mockResolvedValueOnce({
          userReferral: { status: UserReferralStatus.COMPLETED } as any,
          referrerReward: 50,
          referredReward: 20
        });

      await referralController.applyReferral(mockReq, { referralCode: "ANBU8F42" }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "Referral applied successfully",
        data: {
          referrerReward: 50,
          referredReward: 20,
          status: UserReferralStatus.COMPLETED
        }
      });
    });

    it("should return error if member already has a referrer", async () => {
      const memberId = new ObjectId();
      const mockReq = {
        user: { userId: memberId.toString() }
      };

      const mockMember: Member = {
        _id: memberId,
        fullName: "Test Member",
        referredBy: new ObjectId(),
        isDeleted: false
      } as any;

      jest.spyOn((referralController as any).memberRepo, "findOneBy")
        .mockResolvedValueOnce(mockMember);

      await referralController.applyReferral(mockReq, { referralCode: "ANBU8F42" }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("already have an active referrer")
        })
      );
    });
  });

  describe("POST /mobile-api/members/register", () => {
    it("should register member with generated referralCode and process referral if code provided", async () => {
      const referrerId = new ObjectId();
      const mockReferrer: Member = {
        _id: referrerId,
        fullName: "Referrer Member",
        referralCode: "ANBU8F42",
        status: MemberStatus.ACTIVE
      } as any;

      const mockReq = {};
      const registerData = {
        fullName: "New Member",
        mobileNumber: "9123456789",
        email: "newmember@example.com",
        referralCode: "ANBU8F42"
      };

      jest.spyOn((memberController as any).memberRepo, "findOneBy")
        .mockResolvedValue(null); // No duplicates for mobile/email

      jest.spyOn((memberController as any).referralService, "validateReferralCode")
        .mockResolvedValueOnce(mockReferrer);

      jest.spyOn((memberController as any).referralService, "generateUniqueReferralCode")
        .mockResolvedValueOnce("NEWM1234");

      const savedMemberId = new ObjectId();
      jest.spyOn((memberController as any).memberRepo, "save")
        .mockImplementationOnce((m: any) => Promise.resolve({ ...m, _id: savedMemberId }));

      const processReferralSpy = jest.spyOn((memberController as any).referralService, "processReferral")
        .mockResolvedValueOnce({
          userReferral: {} as any,
          referrerReward: 50,
          referredReward: 20
        });

      await memberController.register(mockReq, registerData as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Registration successful",
          data: savedMemberId
        })
      );
      expect(processReferralSpy).toHaveBeenCalled();
    });

    it("should reject registration if invalid referral code is provided", async () => {
      const mockReq = {};
      const registerData = {
        fullName: "New Member",
        mobileNumber: "9123456789",
        email: "newmember@example.com",
        referralCode: "INVALID_CODE"
      };

      jest.spyOn((memberController as any).memberRepo, "findOneBy")
        .mockResolvedValue(null);

      jest.spyOn((memberController as any).referralService, "validateReferralCode")
        .mockRejectedValueOnce(new BadRequestError("Invalid referral code"));

      await memberController.register(mockReq, registerData as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Invalid referral code"
        })
      );
    });
  });
});
