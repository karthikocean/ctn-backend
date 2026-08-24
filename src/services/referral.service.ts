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
import { Plan } from "../entity/Plan";
import { MemberSubscription } from "../entity/MemberSubscription";

export class ReferralService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private userReferralRepo = AppDataSource.getMongoRepository(UserReferral);
  private memberPointsRepo = AppDataSource.getMongoRepository(MemberPoints);
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private subRepo = AppDataSource.getMongoRepository(MemberSubscription);

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
   * Processes a referral for a newly registered member or manual apply:
   * 1. Free Referrer: earns 500 reward points when referred friend registers.
   * 2. Active Subscribed Referrer: status set to PENDING, receives 1 extra month validity when friend subscribes.
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

    // Check if referrer currently has an active paid subscription
    const now = new Date();
    const activeSub = await this.subRepo.findOne({
      where: {
        memberId: referrer._id,
        status: "ACTIVE",
        isDeleted: false
      } as any,
      order: { endDate: "DESC" }
    });
    const isReferrerSubscribed = Boolean(
      activeSub && activeSub.endDate && new Date(activeSub.endDate) > now && !activeSub.isTrial
    );

    // Free / Trial referrer gets 500 points immediately upon registration
    // Active Subscribed (purchased) referrer gets NO points (points = 0); status is PENDING until referred friend purchases plan
    const pointsToAward = !isReferrerSubscribed ? 500 : 0;
    const initialStatus = !isReferrerSubscribed ? UserReferralStatus.COMPLETED : UserReferralStatus.PENDING;

    const userReferral = new UserReferral();
    userReferral.referrerId = referrer._id;
    userReferral.referredUserId = referredMember._id;
    userReferral.referralCode = normalizedCode;
    userReferral.referrerReward = pointsToAward;
    userReferral.referredUserReward = 0;
    userReferral.status = initialStatus;
    userReferral.rewardedAt = !isReferrerSubscribed ? new Date() : (null as any);
    userReferral.isSubscriptionRewarded = false;

    const savedReferral = await this.userReferralRepo.save(userReferral);
    // Update referred user's referredBy field
    await this.memberRepo.updateOne(
      { _id: referredMember._id },
      { $set: { referredBy: referrer._id } }
    );
    referredMember.referredBy = referrer._id;

    // Award 500 points to free / trial referrer
    if (pointsToAward > 0) {
      await this.creditRewardPoints(
        referrer._id,
        pointsToAward,
        "REFERRAL_REFERRER",
        savedReferral._id
      );
    }

    console.log(
      `[ReferralService] Processed referral: Referrer ${referrer._id} (Subscribed: ${isReferrerSubscribed}) -> Referred ${referredMember._id}. Points awarded: ${pointsToAward}`
    );

    return {
      userReferral: savedReferral,
      referrerReward: pointsToAward,
      referredReward: 0
    };
  }

  /**
   * Helper to credit reward points to a member and write PointHistory & MemberPoints
   */
  private async creditRewardPoints(
    memberId: string | ObjectId,
    points: number,
    actionType: "REFERRAL_REFERRER" | "REFERRAL_SIGNUP",
    referenceId: string | ObjectId
  ): Promise<void> {
    const memberOid = new ObjectId(memberId);
    const refOid = new ObjectId(referenceId);
    if (points <= 0) return;

    try {
      await this.memberPointsRepo.updateOne(
        { memberId: memberOid },
        { $inc: { totalPoints: points } },
        { upsert: true }
      );
      await this.memberRepo.updateOne(
        { _id: memberOid },
        { $inc: { points: points } }
      );

      const memberPoints = await this.memberPointsRepo.findOneBy({ memberId });

      const history = new PointHistory();
      history.memberId = memberOid;
      history.moduleName = "referral";
      history.referenceId = refOid;
      history.actionType = actionType;
      history.type = "earned";
      history.points = points;
      history.balanceAfter = memberPoints ? memberPoints.totalPoints : points;
      await this.historyRepo.save(history);
    } catch (err: any) {
      console.error(`[ReferralService] Error crediting reward points to member ${memberId}:`, err.message);
    }
  }

  /**
   * Handles rewarding the referrer when the referred friend purchases a subscription plan:
   * If referrer is in an active purchased (non-trial) plan, extends subscription validity by 1 month.
   */
  async handleReferredUserSubscribed(referredMemberId: string | ObjectId): Promise<void> {
    const referredMemberOid = new ObjectId(referredMemberId);
    try {
      let userReferral = await this.userReferralRepo.findOne({
        where: {
          referredUserId: referredMemberOid
        } as any
      });

      let referrerId = userReferral?.referrerId;

      if (!referrerId) {
        const referredMember = await this.memberRepo.findOneBy({ _id: referredMemberOid, isDeleted: false });
        if (referredMember?.referredBy) {
          referrerId = new ObjectId(referredMember.referredBy);
        }
      }

      if (!referrerId) return;

      const referrer = await this.memberRepo.findOneBy({ _id: referrerId, isDeleted: false });
      if (!referrer) return;

      // Check if subscription reward was already granted for this referral
      if (userReferral?.isSubscriptionRewarded) return;

      // Check if referrer currently has an active purchased (non-trial) subscription
      const now = new Date();
      const activeSub = await this.subRepo.findOne({
        where: {
          memberId: referrer._id,
          status: "ACTIVE",
          isDeleted: false
        } as any,
        order: { endDate: "DESC" }
      });

      const isReferrerPurchasedPlan = Boolean(
        (activeSub && activeSub.endDate && new Date(activeSub.endDate) > now && !activeSub.isTrial) ||
        (referrer.subscriptionEndDate && new Date(referrer.subscriptionEndDate) > now && referrer.hasUsedTrial)
      );

      // Only reward subscription extension if referrer is on an active purchased plan
      if (!isReferrerPurchasedPlan) {
        console.log(`[ReferralService] Referrer ${referrer._id} is not on an active purchased plan. Skipping subscription extension.`);
        return;
      }

      // Bonus months from referrer's plan or default 1
      let bonusMonths = 1;
      if (referrer.planId) {
        const plan = await this.planRepo.findOneBy({ _id: new ObjectId(referrer.planId), isDeleted: false });
        if (plan?.benefits?.referralBonusMonths !== undefined && plan.benefits.referralBonusMonths !== null) {
          bonusMonths = plan.benefits.referralBonusMonths;
        }
      }
      if (bonusMonths <= 0) bonusMonths = 1;

      // Award subscription validity extension
      await this.awardSubscriptionReward(referrer._id, bonusMonths);

      if (userReferral) {
        userReferral.status = UserReferralStatus.COMPLETED;
        userReferral.isSubscriptionRewarded = true;
        userReferral.rewardedAt = new Date();
        await this.userReferralRepo.save(userReferral);
      } else {
        const newRef = new UserReferral();
        newRef.referrerId = referrer._id;
        newRef.referredUserId = referredMemberOid;
        newRef.referralCode = referrer.referralCode || "";
        newRef.referrerReward = 0;
        newRef.referredUserReward = 0;
        newRef.status = UserReferralStatus.COMPLETED;
        newRef.isSubscriptionRewarded = true;
        newRef.rewardedAt = new Date();
        await this.userReferralRepo.save(newRef);
      }

      console.log(
        `[ReferralService] Awarded ${bonusMonths} extra month(s) subscription validity to referrer ${referrer._id} on referred friend ${referredMemberId} purchasing plan`
      );
    } catch (err: any) {
      console.error(`[ReferralService] Error in handleReferredUserSubscribed for user ${referredMemberId}:`, err.message);
    }
  }

  /**
   * Retrieves or auto-generates referral code and stats for the logged-in member
   */
  async getMyReferralInfo(memberId: string | ObjectId): Promise<{
    referralCode: string;
    referralLink: string;
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    totalRewards: number;
  }> {
    const memberOid = new ObjectId(memberId);
    const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
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
  async getReferralStats(referrerId: string | ObjectId): Promise<{
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    totalRewards: number;
  }> {
    const statsResult = await this.userReferralRepo.aggregate([
      { $match: { referrerId: new ObjectId(referrerId) } },
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
    referrerId: string | ObjectId,
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

    const matchQuery: any = { referrerId: new ObjectId(referrerId) };
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
          isSubscriptionRewarded: 1,
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

  /**
   * Awards subscription plan to a member:
   * - If member already has an active subscription: extends subscriptionEndDate by X months.
   * - If member has no active subscription: activates an X-month Basic plan.
   */
  async awardSubscriptionReward(memberId: string | ObjectId, months: number = 1): Promise<void> {
    const memberOid = new ObjectId(memberId);
    try {
      const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
      if (!member) return;

      const now = new Date();

      // Check if member already has an active subscription
      const activeSub = await this.subRepo.findOne({
        where: {
          memberId: member._id,
          status: "ACTIVE",
          isDeleted: false
        } as any,
        order: { endDate: "DESC" }
      });

      const hasActiveSub = (activeSub && activeSub.endDate && new Date(activeSub.endDate) > now) ||
        (member.subscriptionEndDate && new Date(member.subscriptionEndDate) > now);

      if (hasActiveSub) {
        // Extend existing active subscription
        const currentEnd = activeSub?.endDate && new Date(activeSub.endDate) > now
          ? new Date(activeSub.endDate)
          : (member.subscriptionEndDate ? new Date(member.subscriptionEndDate) : now);

        const newEnd = new Date(currentEnd);
        newEnd.setMonth(newEnd.getMonth() + months);

        if (activeSub) {
          activeSub.endDate = newEnd;
          await this.subRepo.save(activeSub);
        }

        await this.memberRepo.updateOne(
          { _id: member._id },
          {
            $set: {
              subscriptionEndDate: newEnd,
              ...(activeSub ? { subscriptionId: activeSub._id, planId: activeSub.planId } : {})
            }
          }
        );
        console.log(`[ReferralService] Extended subscription for member ${member._id} by ${months} month(s) until ${newEnd.toISOString()}`);
      } else {
        // Find default or basic active plan
        let defaultPlan = await this.planRepo.findOne({
          where: { billingType: "basic", status: "active", isDeleted: false } as any,
          order: { amount: "ASC" }
        });

        if (!defaultPlan) {
          defaultPlan = await this.planRepo.findOne({
            where: { status: "active", isDeleted: false } as any,
            order: { amount: "ASC" }
          });
        }

        if (!defaultPlan) {
          console.warn("[ReferralService] No active subscription plan found to award.");
          return;
        }

        // Expire previous active subscriptions
        await this.subRepo.updateMany(
          { memberId: member._id, status: "ACTIVE" },
          { $set: { status: "EXPIRED" } }
        );

        const startDate = now;
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + months);

        const newSub = new MemberSubscription();
        newSub.memberId = member._id;
        newSub.planId = new ObjectId(defaultPlan._id);
        newSub.type = defaultPlan.billingType || "BASIC";
        newSub.status = "ACTIVE";
        newSub.startDate = startDate;
        newSub.endDate = endDate;
        newSub.isTrial = false;
        newSub.isDeleted = false;

        const savedSub = await this.subRepo.save(newSub);

        await this.memberRepo.updateOne(
          { _id: member._id },
          {
            $set: {
              planId: new ObjectId(defaultPlan._id),
              subscriptionId: new ObjectId(savedSub._id),
              subscriptionStartDate: startDate,
              subscriptionEndDate: endDate
            }
          }
        );
        console.log(`[ReferralService] Activated ${months} month(s) subscription (${defaultPlan.title}) for member ${member._id} until ${endDate.toISOString()}`);
      }
    } catch (err: any) {
      console.error(`[ReferralService] Failed to award subscription reward for member ${memberId}:`, err.message);
    }
  }
}
