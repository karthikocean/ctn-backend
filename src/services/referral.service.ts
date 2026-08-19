import { ObjectId } from "mongodb";
import crypto from "crypto";
import { BadRequestError, NotFoundError } from "routing-controllers";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { UserReferral, UserReferralStatus } from "../entity/UserReferral";
import { MemberPoints } from "../entity/MemberPoints";
import { PointHistory } from "../entity/PointHistory";
import { REFERRAL_CONFIG } from "../config/referral.config";
import { DeepLinkFactory } from "./deep-link/deep-link.factory";

export class ReferralService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private userReferralRepo = AppDataSource.getMongoRepository(UserReferral);
  private memberPointsRepo = AppDataSource.getMongoRepository(MemberPoints);
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);

  /**
   * Normalizes referral codes (trims, uppercase, removes disallowed characters)
   */
  normalizeCode(code: string): string {
    if (!code || typeof code !== "string") return "";
    return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /**
   * Generates a unique, collision-free, user-friendly referral code (e.g., ANBU8F42)
   * Avoids ambiguous characters like 0, O, 1, I, L.
   */
  async generateUniqueReferralCode(prefixName?: string): Promise<string> {
    const cleanChars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // No 0, O, 1, I, L

    let prefix = "REF";
    if (prefixName && typeof prefixName === "string") {
      const sanitized = prefixName.trim().toUpperCase().replace(/[^A-Z]/g, "");
      if (sanitized.length >= 3) {
        prefix = sanitized.slice(0, 4);
      } else if (sanitized.length > 0) {
        prefix = sanitized.padEnd(3, "X");
      }
    }

    // Try generating with prefix + 4 random clean chars
    for (let attempt = 0; attempt < 10; attempt++) {
      let randomSuffix = "";
      const randomBytes = crypto.randomBytes(4);
      for (let i = 0; i < 4; i++) {
        randomSuffix += cleanChars[randomBytes[i] % cleanChars.length];
      }

      const candidateCode = `${prefix}${randomSuffix}`;
      const existing = await this.memberRepo.findOne({
        where: { referralCode: candidateCode } as any
      });

      if (!existing) {
        return candidateCode;
      }
    }

    // Fallback: 8 clean random characters
    while (true) {
      let code = "";
      const randomBytes = crypto.randomBytes(8);
      for (let i = 0; i < 8; i++) {
        code += cleanChars[randomBytes[i] % cleanChars.length];
      }
      const existing = await this.memberRepo.findOne({
        where: { referralCode: code } as any
      });
      if (!existing) {
        return code;
      }
    }
  }

  /**
   * Validates a referral code against self-referral, existence, and status
   */
  async validateReferralCode(
    code: string,
    currentUserId?: string | ObjectId,
    currentUserEmail?: string,
    currentUserMobile?: string
  ): Promise<Member> {
    const normalized = this.normalizeCode(code);
    if (!normalized || normalized.length < 3 || normalized.length > 20) {
      throw new BadRequestError("Invalid referral code format");
    }

    const referrer = await this.memberRepo.findOne({
      where: {
        referralCode: normalized,
        isDeleted: false
      } as any
    });

    if (!referrer) {
      throw new BadRequestError("Invalid referral code. No member found with this code.");
    }

    if (referrer.status !== MemberStatus.ACTIVE) {
      throw new BadRequestError("Referral code is inactive.");
    }

    // Self referral checks
    if (currentUserId && referrer._id.toString() === currentUserId.toString()) {
      throw new BadRequestError("You cannot use your own referral code.");
    }

    if (currentUserEmail && referrer.email && referrer.email.toLowerCase() === currentUserEmail.toLowerCase().trim()) {
      throw new BadRequestError("You cannot use your own referral code.");
    }

    if (currentUserMobile && referrer.mobileNumber && referrer.mobileNumber.trim() === currentUserMobile.trim()) {
      throw new BadRequestError("You cannot use your own referral code.");
    }

    return referrer;
  }

  /**
   * Processes a referral for a newly registered member or manual apply
   * Atomically records referral relationship, UserReferral record, and credits reward points.
   */
  async processReferral(params: {
    referredMember: Member;
    referralCode: string;
  }): Promise<{ userReferral: UserReferral; referrerReward: number; referredReward: number }> {
    const { referredMember, referralCode } = params;
    const normalizedCode = this.normalizeCode(referralCode);

    // 1. Validate Referrer
    const referrer = await this.validateReferralCode(
      normalizedCode,
      referredMember._id,
      referredMember.email,
      referredMember.mobileNumber
    );

    // 2. Prevent changing existing referrer
    if (referredMember.referredBy) {
      throw new BadRequestError("User already has an assigned referrer and cannot change it.");
    }

    // 3. Prevent duplicate referral record for the same referred user
    const existingReferral = await this.userReferralRepo.findOne({
      where: { referredUserId: referredMember._id } as any
    });
    if (existingReferral) {
      throw new BadRequestError("Referral reward has already been applied for this user.");
    }

    const referrerReward = REFERRAL_CONFIG.referrerReward;
    const referredUserReward = REFERRAL_CONFIG.referredUserReward;

    const userReferral = new UserReferral();
    userReferral.referrerId = referrer._id;
    userReferral.referredUserId = referredMember._id;
    userReferral.referralCode = normalizedCode;
    userReferral.referrerReward = referrerReward;
    userReferral.referredUserReward = referredUserReward;
    userReferral.status = UserReferralStatus.COMPLETED;
    userReferral.rewardedAt = new Date();

    // 4. Execute atomic / transactional reward disbursement
    const mongoClient = (AppDataSource.mongoManager.queryRunner?.connection?.driver as any)?.mongoClient;
    if (mongoClient && typeof mongoClient.startSession === "function") {
      const session = mongoClient.startSession();
      try {
        let savedReferral: UserReferral | null = null;
        await session.withTransaction(async () => {
          // Double check within transaction context
          const checkTx = await this.userReferralRepo.findOne({
            where: { referredUserId: referredMember._id } as any
          });
          if (checkTx) {
            throw new BadRequestError("Referral already applied.");
          }

          // Save UserReferral
          savedReferral = await this.userReferralRepo.save(userReferral);

          // Update referred user's referredBy field
          await this.memberRepo.updateOne(
            { _id: referredMember._id },
            { $set: { referredBy: referrer._id } }
          );

          // Award referrer reward
          if (referrerReward > 0) {
            await this.creditRewardPoints(referrer._id, referrerReward, "REFERRAL_REFERRER", savedReferral._id);
          }

          // Award referred user reward
          if (referredUserReward > 0) {
            await this.creditRewardPoints(referredMember._id, referredUserReward, "REFERRAL_SIGNUP", savedReferral._id);
          }
        });

        if (savedReferral) {
          referredMember.referredBy = referrer._id;
          console.log(`[ReferralService] Successfully processed referral: Referrer ${referrer._id} -> Referred ${referredMember._id}`);
          return {
            userReferral: savedReferral,
            referrerReward,
            referredReward: referredUserReward
          };
        }
      } catch (txErr: any) {
        if (
          txErr.message?.includes("Transaction") ||
          txErr.message?.includes("session") ||
          txErr.codeName === "IllegalOperation"
        ) {
          // Fall through to non-session fallback below
        } else {
          console.error("[ReferralService] Transaction error:", txErr.message);
          throw txErr;
        }
      } finally {
        await session.endSession();
      }
    }

    // 5. Non-session fallback with strict unique constraint and rollback on collision
    try {
      const savedReferral = await this.userReferralRepo.save(userReferral);

      // Update referred user's referredBy
      await this.memberRepo.updateOne(
        { _id: referredMember._id },
        { $set: { referredBy: referrer._id } }
      );
      referredMember.referredBy = referrer._id;

      // Credit rewards
      if (referrerReward > 0) {
        await this.creditRewardPoints(referrer._id, referrerReward, "REFERRAL_REFERRER", savedReferral._id);
      }
      if (referredUserReward > 0) {
        await this.creditRewardPoints(referredMember._id, referredUserReward, "REFERRAL_SIGNUP", savedReferral._id);
      }

      console.log(`[ReferralService] Successfully processed referral (non-session): Referrer ${referrer._id} -> Referred ${referredMember._id}`);
      return {
        userReferral: savedReferral,
        referrerReward,
        referredReward: referredUserReward
      };
    } catch (err: any) {
      if (err.code === 11000) {
        throw new BadRequestError("Referral reward has already been applied for this user.");
      }
      throw err;
    }
  }

  /**
   * Helper to credit reward points to a member and write PointHistory & MemberPoints
   */
  private async creditRewardPoints(
    memberId: ObjectId,
    points: number,
    actionType: "REFERRAL_REFERRER" | "REFERRAL_SIGNUP",
    referenceId: ObjectId
  ): Promise<void> {
    if (points <= 0) return;

    await this.memberPointsRepo.updateOne(
      { memberId },
      { $inc: { totalPoints: points } },
      { upsert: true }
    );
    await this.memberRepo.updateOne(
      { _id: memberId },
      { $inc: { points: points } }
    );

    const memberPoints = await this.memberPointsRepo.findOneBy({ memberId });

    const history = new PointHistory();
    history.memberId = memberId;
    history.moduleName = "referral";
    history.referenceId = referenceId;
    history.actionType = actionType;
    history.type = "earned";
    history.points = points;
    history.balanceAfter = memberPoints ? memberPoints.totalPoints : points;
    await this.historyRepo.save(history);
  }

  /**
   * Retrieves or auto-generates referral code and stats for the logged-in member
   */
  async getMyReferralInfo(memberId: ObjectId): Promise<{
    referralCode: string;
    referralLink: string;
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    totalRewards: number;
  }> {
    const member = await this.memberRepo.findOneBy({ _id: memberId, isDeleted: false });
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // If member has no referralCode yet, generate and persist it automatically
    if (!member.referralCode) {
      member.referralCode = await this.generateUniqueReferralCode(member.fullName);
      await this.memberRepo.updateOne(
        { _id: member._id },
        { $set: { referralCode: member.referralCode } }
      );
    }

    const deepLinkService = DeepLinkFactory.getService();
    const referralLink = await deepLinkService.createReferralLink(member.referralCode);

    const stats = await this.getReferralStats(member._id);

    return {
      referralCode: member.referralCode,
      referralLink,
      ...stats
    };
  }

  /**
   * Aggregates referral statistics efficiently using MongoDB aggregation
   */
  async getReferralStats(referrerId: ObjectId): Promise<{
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    totalRewards: number;
  }> {
    const statsResult = await this.userReferralRepo.aggregate([
      { $match: { referrerId } },
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: 1 },
          successfulReferrals: {
            $sum: { $cond: [{ $eq: ["$status", UserReferralStatus.COMPLETED] }, 1, 0] }
          },
          pendingReferrals: {
            $sum: { $cond: [{ $eq: ["$status", UserReferralStatus.PENDING] }, 1, 0] }
          },
          totalRewards: {
            $sum: {
              $cond: [
                { $eq: ["$status", UserReferralStatus.COMPLETED] },
                "$referrerReward",
                0
              ]
            }
          }
        }
      }
    ]).toArray();

    if (!statsResult || statsResult.length === 0) {
      return {
        totalReferrals: 0,
        successfulReferrals: 0,
        pendingReferrals: 0,
        totalRewards: 0
      };
    }

    const stat = statsResult[0];
    return {
      totalReferrals: stat.totalReferrals || 0,
      successfulReferrals: stat.successfulReferrals || 0,
      pendingReferrals: stat.pendingReferrals || 0,
      totalRewards: stat.totalRewards || 0
    };
  }

  /**
   * Fetches paginated referral history for a referrer, populating safe referred user info
   */
  async getReferralHistory(
    referrerId: ObjectId,
    options: { page?: number; limit?: number; status?: string; sort?: string }
  ): Promise<{
    referrals: any[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const matchQuery: any = { referrerId };
    if (options.status && Object.values(UserReferralStatus).includes(options.status.toUpperCase() as any)) {
      matchQuery.status = options.status.toUpperCase();
    }

    const sortField = options.sort === "asc" ? 1 : -1;

    const totalCount = await this.userReferralRepo.countDocuments(matchQuery);

    const pipeline = [
      { $match: matchQuery },
      { $sort: { createdAt: sortField } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "members",
          localField: "referredUserId",
          foreignField: "_id",
          as: "referredUser"
        }
      },
      {
        $unwind: {
          path: "$referredUser",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          referrerId: 1,
          referredUserId: 1,
          referralCode: 1,
          referrerReward: 1,
          referredUserReward: 1,
          status: 1,
          rewardedAt: 1,
          createdAt: 1,
          "referredUser.fullName": 1,
          "referredUser.profilePhoto": 1,
          "referredUser.businessName": 1,
          "referredUser.createdAt": 1
        }
      }
    ];

    const results = await this.userReferralRepo.aggregate(pipeline).toArray();

    return {
      referrals: results,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1
      }
    };
  }
}
