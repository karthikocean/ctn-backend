jest.mock("../src/queues/notification.queue", () => ({
  QUEUE_NAMES: {
    PERSONAL: "notification-personal",
    BROADCAST: "notification-broadcast",
    CLEANUP: "notification-cleanup",
    DLQ: "notification-dlq",
  },
  defaultJobOptions: {},
  personalNotificationQueue: {
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    addBulk: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  },
  broadcastNotificationQueue: {
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    close: jest.fn().mockResolvedValue(undefined),
  },
  dlqNotificationQueue: {
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    close: jest.fn().mockResolvedValue(undefined),
  },
  personalQueueEvents: {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  },
  broadcastQueueEvents: {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../src/config/appRedis", () => ({
  appRedis: {
    status: "end",
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
  },
  appRedisConfig: {},
  checkRedisHealth: jest.fn().mockResolvedValue({ status: "connected", latencyMs: 1 }),
}));

jest.mock("../src/config/redis.config", () => ({
  appRedis: {
    status: "end",
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
  },
  redisConnection: {
    status: "end",
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
  },
  appRedisConfig: {},
  bullRedisConfig: {},
  redisConfig: {},
}));

import { ObjectId } from "mongodb";
import { BadRequestError } from "routing-controllers";
import { MobileReferralController } from "../src/controllers/mobile/ReferralController";
import { MobileMemberController } from "../src/controllers/mobile/MemberController";
import { Member, MemberStatus } from "../src/entity/Member";
import { UserReferralStatus } from "../src/entity/UserReferral";
import { ReferralService } from "../src/services/referral.service";
import { WelcomeCardService } from "../src/services/welcomeCard.service";
import { GstAlertService } from "../src/services/gstAlert.service";
import { AppDataSource } from "../src/data-source";

describe("Referral Controller & Registration Integration Tests", () => {
  let referralController: MobileReferralController;
  let memberController: MobileMemberController;
  let mockRes: any;
  let mockMemberRepo: any;

  beforeEach(() => {
    mockMemberRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((m: any) => Promise.resolve({ ...m, _id: m._id || new ObjectId() })),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 })
    };

    const defaultMockRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((m: any) => Promise.resolve({ ...m, _id: m._id || new ObjectId() })),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 })
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Member || entity?.name === "Member") return mockMemberRepo as any;
      return defaultMockRepo as any;
    });

    jest.spyOn(WelcomeCardService, "sendRegistrationWelcomeEmailToAdmin").mockResolvedValue(undefined as any);
    jest.spyOn(GstAlertService, "notifySecondUserRegistered").mockResolvedValue(undefined as any);
    jest.spyOn(GstAlertService, "notifySuspiciousAttempt").mockResolvedValue(undefined as any);

    referralController = new MobileReferralController();
    memberController = new MobileMemberController();

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const { appRedis } = await import("../src/config/appRedis");
      if (appRedis) {
        if (appRedis.status === "ready" || appRedis.status === "connecting") {
          await appRedis.quit().catch(() => appRedis.disconnect());
        } else {
          appRedis.disconnect();
        }
      }
    } catch { }
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

      jest.spyOn(ReferralService.prototype, "getMyReferralInfo")
        .mockResolvedValueOnce(mockInfo);

      await referralController.getMyReferralInfo(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockInfo
      });
    });
  });

  describe("GET /mobile-api/referrals/list", () => {
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

      jest.spyOn(ReferralService.prototype, "getReferralHistory")
        .mockResolvedValueOnce(mockHistoryResult);

      await referralController.getReferralList(mockReq, { page: 1, limit: 20 } as any, mockRes);

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

      mockMemberRepo.findOneBy.mockResolvedValueOnce(mockMember);

      jest.spyOn(ReferralService.prototype, "processReferral")
        .mockResolvedValueOnce({
          userReferral: { status: UserReferralStatus.COMPLETED } as any,
          referrerReward: 50,
          referredReward: 20
        });

      await referralController.applyReferral(mockReq, { referralCode: "ANBU8F42" } as any, mockRes);

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

      mockMemberRepo.findOneBy.mockResolvedValueOnce(mockMember);

      await referralController.applyReferral(mockReq, { referralCode: "ANBU8F42" } as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("already have an active referrer")
        })
      );
    });
  });

  describe("POST /mobile-api/referrals/verify", () => {
    it("should successfully verify a valid active referral code", async () => {
      const referrerId = new ObjectId();
      const mockReferrer: Member = {
        _id: referrerId,
        fullName: "Anbu Elumalai",
        businessName: "CTN Technologies",
        profilePhoto: "https://example.com/avatar.jpg",
        referralCode: "ANBU8F42",
        status: MemberStatus.ACTIVE,
        isDeleted: false
      } as any;

      jest.spyOn(ReferralService.prototype, "validateReferralCode")
        .mockResolvedValueOnce(mockReferrer);

      const mockReq = { headers: {} };
      await referralController.verifyReferralCode(
        mockReq,
        { referralCode: "ANBU8F42" },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "Referral code is valid",
        data: {
          isValid: true,
          referralCode: "ANBU8F42",
          referrer: {
            id: referrerId.toString(),
            fullName: "Anbu Elumalai",
            businessName: "CTN Technologies",
            profilePhoto: "https://example.com/avatar.jpg"
          }
        }
      });
    });

    it("should fail verification with 400 when referral code is missing or empty", async () => {
      const mockReq = { headers: {} };
      await referralController.verifyReferralCode(
        mockReq,
        { referralCode: "" },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Referral code is required")
        })
      );
    });

    it("should return 400 when referral code is invalid or not found", async () => {
      jest.spyOn(ReferralService.prototype, "validateReferralCode")
        .mockRejectedValueOnce(new BadRequestError("Invalid referral code. No member found with this code."));

      const mockReq = { headers: {} };
      await referralController.verifyReferralCode(
        mockReq,
        { referralCode: "NONEXIST1" },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Invalid referral code")
        })
      );
    });

    it("should pass user email and phone to validateReferralCode to check self-referral", async () => {
      const validateSpy = jest.spyOn(ReferralService.prototype, "validateReferralCode")
        .mockRejectedValueOnce(new BadRequestError("You cannot use your own referral code."));

      const mockReq = { headers: {} };
      await referralController.verifyReferralCode(
        mockReq,
        { referralCode: "ANBU8F42", email: "anbu@example.com", mobileNumber: "9876543210" },
        mockRes
      );

      expect(validateSpy).toHaveBeenCalledWith("ANBU8F42", undefined, "anbu@example.com", "9876543210");
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "You cannot use your own referral code."
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

      const savedMemberId = new ObjectId();
      mockMemberRepo.findOneBy.mockResolvedValue(null);
      mockMemberRepo.find.mockResolvedValue([]);
      mockMemberRepo.save.mockImplementationOnce((m: any) => Promise.resolve({ ...m, _id: savedMemberId }));

      jest.spyOn(ReferralService.prototype, "validateReferralCode")
        .mockResolvedValueOnce(mockReferrer);

      jest.spyOn(ReferralService.prototype, "generateUniqueReferralCode")
        .mockResolvedValueOnce("NEWM1234");

      const processReferralSpy = jest.spyOn(ReferralService.prototype, "processReferral")
        .mockResolvedValueOnce({
          userReferral: {} as any,
          referrerReward: 0,
          referredReward: 0
        });

      await memberController.register(mockReq, registerData as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Registration successful",
          data: {
            memberId: savedMemberId.toString()
          }
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

      mockMemberRepo.findOneBy.mockResolvedValue(null);
      mockMemberRepo.find.mockResolvedValue([]);

      jest.spyOn(ReferralService.prototype, "validateReferralCode")
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
