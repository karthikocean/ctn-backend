import { ObjectId } from "mongodb";
import { ReferralService } from "../src/services/referral.service";
import { Member, MemberStatus } from "../src/entity/Member";
import { UserReferral, UserReferralStatus } from "../src/entity/UserReferral";
import { MemberPoints } from "../src/entity/MemberPoints";
import { PointHistory } from "../src/entity/PointHistory";
import { AppDataSource } from "../src/data-source";
import { DefaultDeepLinkService } from "../src/services/deep-link/default-deep-link.service";
import { DeplDeepLinkService } from "../src/services/deep-link/depl-deep-link.service";
import { REFERRAL_CONFIG } from "../src/config/referral.config";

describe("ReferralService Unit Tests", () => {
  let referralService: ReferralService;

  let mockMemberRepo: any;
  let mockUserReferralRepo: any;
  let mockMemberPointsRepo: any;
  let mockHistoryRepo: any;

  beforeEach(() => {
    referralService = new ReferralService();

    mockMemberRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
      save: jest.fn().mockImplementation((m) => Promise.resolve({ ...m, _id: m._id || new ObjectId() }))
    };

    mockUserReferralRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((r) => Promise.resolve({ ...r, _id: new ObjectId() })),
      aggregate: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0)
    };

    mockMemberPointsRepo = {
      findOneBy: jest.fn().mockResolvedValue({ totalPoints: 100 }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true })
    };

    mockHistoryRepo = {
      save: jest.fn().mockImplementation((h) => Promise.resolve({ ...h, _id: new ObjectId() }))
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Member || entity?.name === "Member") return mockMemberRepo;
      if (entity === UserReferral || entity?.name === "UserReferral") return mockUserReferralRepo;
      if (entity === MemberPoints || entity?.name === "MemberPoints") return mockMemberPointsRepo;
      if (entity === PointHistory || entity?.name === "PointHistory") return mockHistoryRepo;
      return {} as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Code Generation & Normalization", () => {
    it("should normalize referral code by trimming, uppercasing, and removing special characters", () => {
      expect(referralService.normalizeCode("  anbu-8f42!  ")).toBe("ANBU8F42");
      expect(referralService.normalizeCode("")).toBe("");
      expect(referralService.normalizeCode(null as any)).toBe("");
    });

    it("should generate clean, collision-free referral code using prefix from user name", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(null); // No collision
      const code = await referralService.generateUniqueReferralCode("Anbu Elumalai");

      expect(code).toMatch(/^ANBU[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      // Ensure ambiguous characters (0, O, 1, I, L) are never generated
      expect(code.slice(4)).not.toMatch(/[01OIL]/);
    });

    it("should fallback to clean prefix if name is short or missing", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(null);
      const code = await referralService.generateUniqueReferralCode("A");
      expect(code.startsWith("AXX")).toBe(true);
    });
  });

  describe("validateReferralCode", () => {
    const referrerId = new ObjectId();
    const mockReferrer: Member = {
      _id: referrerId,
      fullName: "Anbu Elumalai",
      mobileNumber: "9876543210",
      email: "anbu@example.com",
      status: MemberStatus.ACTIVE,
      referralCode: "ANBU8F42",
      isDeleted: false
    } as any;

    it("should validate and return referrer when code is valid", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);

      const result = await referralService.validateReferralCode("ANBU8F42", new ObjectId());
      expect(result).toBe(mockReferrer);
    });

    it("should throw error when code does not exist", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        referralService.validateReferralCode("NONEXIST", new ObjectId())
      ).rejects.toThrow("Invalid referral code");
    });

    it("should throw error when referrer is inactive", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce({
        ...mockReferrer,
        status: MemberStatus.INACTIVE
      });

      await expect(
        referralService.validateReferralCode("ANBU8F42", new ObjectId())
      ).rejects.toThrow("Referral code is inactive");
    });

    it("should block self-referral by user ID", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);

      await expect(
        referralService.validateReferralCode("ANBU8F42", referrerId)
      ).rejects.toThrow("You cannot use your own referral code");
    });

    it("should block self-referral by matching email", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);

      await expect(
        referralService.validateReferralCode("ANBU8F42", new ObjectId(), "anbu@example.com")
      ).rejects.toThrow("You cannot use your own referral code");
    });

    it("should block self-referral by matching mobile number", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);

      await expect(
        referralService.validateReferralCode("ANBU8F42", new ObjectId(), undefined, "9876543210")
      ).rejects.toThrow("You cannot use your own referral code");
    });
  });

  describe("processReferral", () => {
    let referrerId: ObjectId;
    let referredId: ObjectId;
    let mockReferrer: Member;
    let mockReferred: Member;

    beforeEach(() => {
      referrerId = new ObjectId();
      referredId = new ObjectId();

      mockReferrer = {
        _id: referrerId,
        fullName: "Referrer User",
        mobileNumber: "9876543210",
        email: "referrer@example.com",
        status: MemberStatus.ACTIVE,
        referralCode: "REFR1234",
        points: 50,
        isDeleted: false
      } as any;

      mockReferred = {
        _id: referredId,
        fullName: "Referred User",
        mobileNumber: "9123456780",
        email: "referred@example.com",
        status: MemberStatus.ACTIVE,
        points: 0,
        referredBy: undefined,
        isDeleted: false
      } as any;
    });

    it("should process referral and register referral in pending status until plan/trial activation", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);
      mockUserReferralRepo.findOne.mockResolvedValueOnce(null); // No previous referral

      const result = await referralService.processReferral({
        referredMember: mockReferred,
        referralCode: "REFR1234"
      });

      expect(result.referrerReward).toBe(0);
      expect(result.referredReward).toBe(0);
      expect(mockReferred.referredBy).toEqual(referrerId);
      expect(mockUserReferralRepo.save).toHaveBeenCalled();
      expect(mockMemberRepo.updateOne).toHaveBeenCalledWith(
        { _id: referredId },
        { $set: { referredBy: referrerId } }
      );
    });

    it("should reject referral if referred user already has a referrer", async () => {
      const alreadyReferredMember = {
        ...mockReferred,
        referredBy: new ObjectId()
      };
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);

      await expect(
        referralService.processReferral({
          referredMember: alreadyReferredMember,
          referralCode: "REFR1234"
        })
      ).rejects.toThrow("User already has an assigned referrer");
    });

    it("should reject referral if reward was already processed for this user", async () => {
      mockMemberRepo.findOne.mockResolvedValueOnce(mockReferrer);
      mockUserReferralRepo.findOne.mockResolvedValueOnce({
        _id: new ObjectId(),
        referrerId,
        referredUserId: referredId
      });

      await expect(
        referralService.processReferral({
          referredMember: mockReferred,
          referralCode: "REFR1234"
        })
      ).rejects.toThrow("Referral reward has already been applied");
    });
  });

  describe("getMyReferralInfo & Stats", () => {
    it("should auto-generate referralCode for member if missing and return link + stats", async () => {
      const memberId = new ObjectId();
      mockMemberRepo.findOneBy.mockResolvedValueOnce({
        _id: memberId,
        fullName: "Karthik Kumar",
        isDeleted: false
      });
      mockMemberRepo.findOne.mockResolvedValueOnce(null); // Code collision check
      mockUserReferralRepo.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          {
            totalReferrals: 5,
            successfulReferrals: 4,
            pendingReferrals: 1,
            totalRewards: 200
          }
        ])
      });

      const info = await referralService.getMyReferralInfo(memberId);

      expect(info.referralCode).toBeDefined();
      expect(info.referralLink).toContain(info.referralCode);
      expect(info.totalReferrals).toBe(5);
      expect(info.successfulReferrals).toBe(4);
      expect(info.pendingReferrals).toBe(1);
      expect(info.totalRewards).toBe(200);
    });
  });

  describe("Deep Link Services", () => {
    it("DefaultDeepLinkService should create correct direct link", async () => {
      const service = new DefaultDeepLinkService();
      const link = await service.createReferralLink("ANBU8F42");
      const expectedBase = REFERRAL_CONFIG.baseUrl.replace(/\/+$/, "");
      expect(link).toBe(`${expectedBase}/ANBU8F42`);
    });

    it("DeplDeepLinkService should fall back to URL if credentials are not configured", async () => {
      const service = new DeplDeepLinkService();
      const link = await service.createReferralLink("ANBU8F42");
      const expectedBase = REFERRAL_CONFIG.baseUrl.replace(/\/+$/, "");
      expect(link).toBe(`${expectedBase}/ANBU8F42`);
    });
  });
});
