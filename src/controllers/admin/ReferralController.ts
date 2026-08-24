import {
  JsonController,
  Get,
  Param,
  QueryParams,
  Res,
  Req,
  UseBefore,
  BadRequestError,
  NotFoundError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member, MemberStatus } from "../../entity/Member";
import { UserReferral, UserReferralStatus } from "../../entity/UserReferral";
import { Category } from "../../entity/Category";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { AdminReferralListQueryDto, ReferralActivityFilter } from "../../dto/admin/Referral.dto";

@JsonController("/referrals")
@UseBefore(AuthMiddleware, franchiseFilter)
export class AdminReferralController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private userReferralRepo = AppDataSource.getMongoRepository(UserReferral);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /api/admin/referrals/stats:
   *   get:
   *     summary: Get overall referral performance stats (Admin)
   *     tags: [Admin Referral]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/stats")
  @UseBefore(canAccess("referral", "view"))
  async getReferralStats(@Req() req: any, @Res() res: any) {
    try {
      const [totalCompleted, totalPending, totalReferrals] = await Promise.all([
        this.userReferralRepo.countDocuments({ status: UserReferralStatus.COMPLETED }),
        this.userReferralRepo.countDocuments({ status: UserReferralStatus.PENDING }),
        this.userReferralRepo.countDocuments({})
      ]);

      const rewardsAgg = await this.userReferralRepo.aggregate([
        { $match: { status: UserReferralStatus.COMPLETED } },
        { $group: { _id: null, totalRewards: { $sum: "$referrerReward" } } }
      ]).toArray();

      const totalRewards = rewardsAgg.length > 0 ? (rewardsAgg[0].totalRewards || 0) : 0;

      const activeReferrersAgg = await this.userReferralRepo.aggregate([
        { $group: { _id: "$referrerId" } },
        { $count: "totalReferrers" }
      ]).toArray();

      const totalReferrers = activeReferrersAgg.length > 0 ? (activeReferrersAgg[0].totalReferrers || 0) : 0;

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          totalReferrals,
          totalCompleted,
          totalPending,
          totalReferrers,
          totalRewards
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/referrals:
   *   get:
   *     summary: Get paginated member referrals with search, filter, and count (Admin)
   *     tags: [Admin Referral]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/")
  @UseBefore(canAccess("referral", "view"))
  async getReferralsList(
    @Req() req: any,
    @QueryParams() query: AdminReferralListQueryDto,
    @Res() res: any
  ) {
    const page = Math.max(0, Number(query.page) || 0);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const skip = page * limit;

    try {
      const matchConditions: any = { isDeleted: false };

      // Franchise Area restriction if user is franchise
      if (req.isFranchise) {
        if (req.franchiseAreaIds && req.franchiseAreaIds.length > 0) {
          matchConditions.businessRegion = { $in: req.franchiseAreaIds };
        } else {
          matchConditions.businessRegion = new ObjectId();
        }
      }

      // Filter by Member Status
      if (query.status && query.status !== "all") {
        matchConditions.status = query.status;
      }

      // Filter by Category
      if (query.category && query.category !== "all" && ObjectId.isValid(query.category)) {
        matchConditions.businessCategory = new ObjectId(query.category);
      }

      // Filter by Registration Date Range
      if (query.startDate || query.endDate) {
        matchConditions.createdAt = {};
        if (query.startDate) {
          matchConditions.createdAt.$gte = new Date(query.startDate);
        }
        if (query.endDate) {
          const end = new Date(query.endDate);
          end.setHours(23, 59, 59, 999);
          matchConditions.createdAt.$lte = end;
        }
      }

      const pipeline: any[] = [
        { $match: matchConditions },

        // Lookup business category name
        {
          $lookup: {
            from: "categories",
            localField: "businessCategory",
            foreignField: "_id",
            as: "categoryDetails"
          }
        },
        {
          $unwind: {
            path: "$categoryDetails",
            preserveNullAndEmptyArrays: true
          }
        },

        // Lookup referrer member details (who referred this member)
        {
          $lookup: {
            from: "members",
            localField: "referredBy",
            foreignField: "_id",
            as: "referrerDetails"
          }
        },
        {
          $unwind: {
            path: "$referrerDetails",
            preserveNullAndEmptyArrays: true
          }
        },

        // Lookup referral records where this member is the referrer
        {
          $lookup: {
            from: "user_referrals",
            localField: "_id",
            foreignField: "referrerId",
            as: "referralsMade"
          }
        },
        {
          $addFields: {
            referredCount: { $size: "$referralsMade" }
          }
        }
      ];

      // Referral Activity Filters
      if (query.referralFilter) {
        if (query.referralFilter === ReferralActivityFilter.HAS_REFERRALS) {
          pipeline.push({ $match: { referredCount: { $gt: 0 } } });
        } else if (query.referralFilter === ReferralActivityFilter.NO_REFERRALS) {
          pipeline.push({ $match: { referredCount: 0 } });
        } else if (query.referralFilter === ReferralActivityFilter.WAS_REFERRED) {
          pipeline.push({ $match: { referredBy: { $exists: true, $ne: null } } });
        } else if (query.referralFilter === ReferralActivityFilter.DIRECT) {
          pipeline.push({
            $match: {
              $or: [{ referredBy: { $exists: false } }, { referredBy: null }]
            }
          });
        }
      }

      // Text Search across member name, email, mobile, referralCode, category, and referrer name
      if (query.search && query.search.trim()) {
        const searchRegex = new RegExp(query.search.trim(), "i");
        pipeline.push({
          $match: {
            $or: [
              { fullName: searchRegex },
              { email: searchRegex },
              { mobileNumber: searchRegex },
              { referralCode: searchRegex },
              { "categoryDetails.name": searchRegex },
              { "referrerDetails.fullName": searchRegex }
            ]
          }
        });
      }

      // Sorting
      let sortStage: any = { createdAt: -1 };
      if (query.sortBy === "referredCount") {
        sortStage = { referredCount: -1, createdAt: -1 };
      } else if (query.sortBy === "name") {
        sortStage = { fullName: 1 };
      }
      pipeline.push({ $sort: sortStage });

      // Facet for pagination
      pipeline.push({
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      });

      const [aggregateResult] = await this.memberRepo.aggregate(pipeline).toArray();

      const totalCount = aggregateResult?.metadata?.[0]?.total || 0;
      const rawMembers = aggregateResult?.data || [];

      const formattedData = rawMembers.map((m: any) => ({
        _id: m._id,
        id: m._id?.toString(),
        name: m.fullName || "-",
        email: m.email || "-",
        mobileNumber: m.mobileNumber || "-",
        profilePhoto: m.profilePhoto || null,
        category: m.categoryDetails?.name || "General",
        categoryId: m.businessCategory || null,
        referralCode: m.referralCode || "-",
        referredCount: m.referredCount || 0,
        referredBy: m.referrerDetails?.fullName || "Direct",
        referredByDetails: m.referrerDetails
          ? {
            _id: m.referrerDetails._id,
            name: m.referrerDetails.fullName,
            email: m.referrerDetails.email,
            referralCode: m.referrerDetails.referralCode
          }
          : null,
        status: m.status || MemberStatus.ACTIVE,
        createdAt: m.createdAt
      }));

      return pagination(totalCount, formattedData, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/referrals/{id}/referred-members:
   *   get:
   *     summary: Get list of members referred by a specific member (Admin Preview)
   *     tags: [Admin Referral]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/:id/referred-members")
  @UseBefore(canAccess("referral", "view"))
  async getReferredMembers(
    @Req() req: any,
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid member ID");
      }

      const referrerId = new ObjectId(id);
      const referrer = await this.memberRepo.findOneBy({ _id: referrerId, isDeleted: false });
      if (!referrer) {
        throw new NotFoundError("Referrer member not found");
      }

      // Query UserReferral records
      const referralsPipeline = [
        { $match: { referrerId: referrerId } },
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: "members",
            localField: "referredUserId",
            foreignField: "_id",
            as: "referredMember"
          }
        },
        {
          $unwind: {
            path: "$referredMember",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "categories",
            localField: "referredMember.businessCategory",
            foreignField: "_id",
            as: "categoryDetails"
          }
        },
        {
          $unwind: {
            path: "$categoryDetails",
            preserveNullAndEmptyArrays: true
          }
        }
      ];

      const referralRecords = await this.userReferralRepo.aggregate(referralsPipeline).toArray();

      // Collect referred member IDs found in user_referrals
      const matchedUserIds = new Set<string>();

      const referredMembersList = referralRecords.map((r: any) => {
        if (r.referredUserId) {
          matchedUserIds.add(r.referredUserId.toString());
        }
        const member = r.referredMember;
        const statusLabel = r.status === UserReferralStatus.COMPLETED
          ? (member?.status === MemberStatus.ACTIVE ? "Active" : (member?.status ? member.status.charAt(0).toUpperCase() + member.status.slice(1) : "Active"))
          : (r.status === UserReferralStatus.PENDING ? "Pending" : "Cancelled");

        return {
          id: r._id?.toString(),
          memberId: r.referredUserId?.toString(),
          name: member?.fullName || "Registered Member",
          email: member?.email || "-",
          mobileNumber: member?.mobileNumber || "-",
          profilePhoto: member?.profilePhoto || null,
          category: r.categoryDetails?.name || "General",
          date: r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-",
          rawDate: r.createdAt,
          status: statusLabel,
          referralStatus: r.status,
          reward: r.referrerReward || 0,
          isSubscriptionRewarded: Boolean(r.isSubscriptionRewarded)
        };
      });

      // Fallback: check if any members have referredBy == referrerId but no UserReferral record
      const directReferredMembers = await this.memberRepo.find({
        where: { referredBy: referrerId, isDeleted: false } as any
      });

      for (const dm of directReferredMembers) {
        if (!matchedUserIds.has(dm._id.toString())) {
          let categoryName = "General";
          if (dm.businessCategory) {
            const cat = await this.categoryRepo.findOneBy({ _id: dm.businessCategory });
            if (cat) categoryName = cat.name;
          }
          referredMembersList.push({
            id: dm._id.toString(),
            memberId: dm._id.toString(),
            name: dm.fullName,
            email: dm.email || "-",
            mobileNumber: dm.mobileNumber || "-",
            profilePhoto: dm.profilePhoto || null,
            category: categoryName,
            date: dm.createdAt ? new Date(dm.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-",
            rawDate: dm.createdAt,
            status: dm.status === MemberStatus.ACTIVE ? "Active" : (dm.status ? dm.status.charAt(0).toUpperCase() + dm.status.slice(1) : "Active"),
            referralStatus: UserReferralStatus.COMPLETED,
            reward: 0,
            isSubscriptionRewarded: false
          });
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          referrer: {
            _id: referrer._id,
            name: referrer.fullName,
            email: referrer.email,
            mobileNumber: referrer.mobileNumber,
            referralCode: referrer.referralCode,
            totalReferrals: referredMembersList.length
          },
          referredMembers: referredMembersList
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
