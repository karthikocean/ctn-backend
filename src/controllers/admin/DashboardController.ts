import {
  JsonController,
  Get,
  QueryParam,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member, MemberStatus } from "../../entity/Member";
import { PostModel, PostType } from "../../entity/Post";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Training } from "../../entity/Training";
import { MemberTraining } from "../../entity/MemberTraining";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { State } from "../../entity/State";
import { Category } from "../../entity/Category";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";

export function getDashboardDateRange(preset?: string, startDateParam?: string, endDateParam?: string): { startDate: Date | null; endDate: Date } {
  const now = new Date();
  let endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);

  let startDate: Date | null = null;

  if (startDateParam || endDateParam) {
    if (startDateParam) {
      startDate = new Date(startDateParam);
      startDate.setHours(0, 0, 0, 0);
    }
    if (endDateParam) {
      endDate = new Date(endDateParam);
      endDate.setHours(23, 59, 59, 999);
    }
    return { startDate, endDate };
  }

  const selectedPreset = (preset || "today").toLowerCase();

  switch (selectedPreset) {
  case "today": {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    break;
  }
  case "this_week": {
    startDate = new Date(now);
    const day = startDate.getDay();
    const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
    startDate.setDate(diff);
    startDate.setHours(0, 0, 0, 0);
    break;
  }
  case "this_month": {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    break;
  }
  case "this_year": {
    startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    break;
  }
  case "all_time": {
    startDate = null;
    break;
  }
  default: {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    break;
  }
  }

  return { startDate, endDate };
}

@JsonController("/dashboard")
@UseBefore(AuthMiddleware)
export class AdminDashboardController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private postRepo = AppDataSource.getMongoRepository(PostModel);
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private thankYouSlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private trainingRepo = AppDataSource.getMongoRepository(Training);
  private memberTrainingRepo = AppDataSource.getMongoRepository(MemberTraining);
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private stateRepo = AppDataSource.getMongoRepository(State);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /api/admin/dashboard/stats:
   *   get:
   *     summary: Fetch Dashboard analytics metrics and chart data with filtering capabilities
   *     tags: [Admin Dashboard]
   *     parameters:
   *       - in: query
   *         name: preset
   *         schema:
   *           type: string
   *           enum: [today, this_week, this_month, this_year, all_time]
   *           default: today
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           example: "2026-08-01"
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           example: "2026-08-31"
   *       - in: query
   *         name: regionId
   *         schema:
   *           type: string
   *       - in: query
   *         name: categoryId
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Dashboard statistics and charts successfully retrieved
   */
  @Get("/stats")
  async getDashboardStats(
    @Req() req: any,
    @QueryParam("preset") preset: string,
    @QueryParam("startDate") startDateParam: string,
    @QueryParam("endDate") endDateParam: string,
    @QueryParam("regionId") regionId: string,
    @QueryParam("categoryId") categoryId: string,
    @Res() res: any
  ) {
    try {
      const { startDate, endDate } = getDashboardDateRange(preset, startDateParam, endDateParam);

      // Build member base query
      const memberQuery: any = { isDeleted: false };
      if (regionId && ObjectId.isValid(regionId)) {
        memberQuery.businessRegion = new ObjectId(regionId);
      }
      if (categoryId && ObjectId.isValid(categoryId)) {
        memberQuery.businessCategory = new ObjectId(categoryId);
      }

      if (req.isFranchise && req.franchiseAreaIds && Array.isArray(req.franchiseAreaIds) && req.franchiseAreaIds.length > 0) {
        memberQuery.businessRegion = { $in: req.franchiseAreaIds };
      }

      const allMembers = await this.memberRepo.find({ where: memberQuery });
      const memberOidSet = new Set(allMembers.map(m => m._id.toString()));
      const memberOids = allMembers.map(m => m._id);

      const totalMembers = allMembers.length;
      const activeMembers = allMembers.filter(m => m.status === MemberStatus.ACTIVE).length;

      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const expiringSoon = allMembers.filter(m => {
        if (!m.subscriptionEndDate) return false;
        const exp = new Date(m.subscriptionEndDate);
        return exp >= now && exp <= thirtyDaysFromNow;
      }).length;

      const expiredMembers = allMembers.filter(m => {
        if (m.status === MemberStatus.INACTIVE) return true;
        if (!m.subscriptionEndDate) return false;
        const exp = new Date(m.subscriptionEndDate);
        return exp < now;
      }).length;

      // Build post query
      const postQuery: any = { isDeleted: false };
      if (memberOids.length > 0) {
        postQuery.memberId = { $in: memberOids };
      } else if (regionId || categoryId || req.isFranchise) {
        postQuery.memberId = { $in: [] };
      }

      if (startDate) {
        postQuery.createdAt = { $gte: startDate, $lte: endDate };
      } else {
        postQuery.createdAt = { $lte: endDate };
      }

      const matchingPosts = await this.postRepo.find({ where: postQuery });

      const todayPost = matchingPosts.filter(p => p.type === PostType.PROMOTION).length;
      const todayAsk = matchingPosts.filter(p => p.type === PostType.ASK).length;
      const todayGive = matchingPosts.filter(p => p.type === PostType.GIVE).length;
      const todayRequirement = matchingPosts.filter(p => p.type === PostType.REQUIREMENT).length;

      // Activity gaps
      const activeMemberObjs = allMembers.filter(m => m.status === MemberStatus.ACTIVE);

      const membersWhoPosted = new Set(
        matchingPosts.filter(p => p.type === PostType.PROMOTION).map(p => p.memberId?.toString()).filter(Boolean)
      );
      const membersWhoAsked = new Set(
        matchingPosts.filter(p => p.type === PostType.ASK).map(p => p.memberId?.toString()).filter(Boolean)
      );
      const membersWhoGiven = new Set(
        matchingPosts.filter(p => p.type === PostType.GIVE).map(p => p.memberId?.toString()).filter(Boolean)
      );
      const membersWhoRequired = new Set(
        matchingPosts.filter(p => p.type === PostType.REQUIREMENT).map(p => p.memberId?.toString()).filter(Boolean)
      );

      const notPosted = activeMemberObjs.filter(m => !membersWhoPosted.has(m._id.toString())).length;
      const notAsked = activeMemberObjs.filter(m => !membersWhoAsked.has(m._id.toString())).length;
      const notGiven = activeMemberObjs.filter(m => !membersWhoGiven.has(m._id.toString())).length;
      const notRequirements = activeMemberObjs.filter(m => !membersWhoRequired.has(m._id.toString())).length;

      // Date query for interactions (Overall counts unless explicit custom startDateParam is passed)
      const interactionDateQuery: any = {};
      if (startDateParam) {
        const customStart = new Date(startDateParam);
        customStart.setHours(0, 0, 0, 0);
        interactionDateQuery.createdAt = { $gte: customStart, $lte: endDate };
      } else {
        interactionDateQuery.createdAt = { $lte: endDate };
      }

      // One To One
      const allOneToOnes = await this.oneToOneRepo.find({ where: interactionDateQuery });
      const filteredOneToOnes = (regionId || categoryId || req.isFranchise)
        ? allOneToOnes.filter(o => memberOidSet.has(o.senderId?.toString()) || memberOidSet.has(o.receiverId?.toString()))
        : allOneToOnes;
      const oneToOneCount = filteredOneToOnes.length;

      // Referral
      const allReferrals = await this.referralRepo.find({ where: interactionDateQuery });
      const filteredReferrals = (regionId || categoryId || req.isFranchise)
        ? allReferrals.filter(r => memberOidSet.has(r.senderId?.toString()) || memberOidSet.has(r.receiverId?.toString()))
        : allReferrals;
      const referralCount = filteredReferrals.length;

      // Thank You Slips
      const allThankYouSlips = await this.thankYouSlipRepo.find({ where: interactionDateQuery });
      const filteredThankYouSlips = (regionId || categoryId || req.isFranchise)
        ? allThankYouSlips.filter(t => memberOidSet.has(t.senderId?.toString()) || memberOidSet.has(t.receiverId?.toString()))
        : allThankYouSlips;

      const thankYouSlipCount = filteredThankYouSlips.length;
      const thankYouSlipAmount = filteredThankYouSlips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      // =========================================================
      // DYNAMIC CHARTS DATA AGGREGATION
      // =========================================================

      // 1. Month names generator for last 7 months
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const last7Months: { name: string; year: number; monthIdx: number; start: Date; end: Date }[] = [];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
        const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        last7Months.push({
          name: monthNames[d.getMonth()],
          year: d.getFullYear(),
          monthIdx: d.getMonth(),
          start: d,
          end: endOfMonth
        });
      }

      // Fetch all trainings & member trainings for training trend chart
      const allTrainings = await this.trainingRepo.find({ where: { isDeleted: false } as any });
      const allMemberTrainings = await this.memberTrainingRepo.find({});

      const trainingTrend = last7Months.map(m => {
        const trainingsInMonth = allTrainings.filter(t => {
          if (!t.createdAt) return false;
          const dt = new Date(t.createdAt);
          return dt >= m.start && dt <= m.end;
        }).length;

        const viewsInMonth = allMemberTrainings.filter(mt => {
          if (!mt.createdAt) return false;
          const dt = new Date(mt.createdAt);
          return dt >= m.start && dt <= m.end;
        }).length;

        return {
          month: m.name,
          trainings: trainingsInMonth,
          views: viewsInMonth
        };
      });

      // 2. Members Trend (Joined vs Expired per month)
      const membersTrend = last7Months.map(m => {
        const joinedInMonth = allMembers.filter(mem => {
          if (!mem.createdAt) return false;
          const dt = new Date(mem.createdAt);
          return dt >= m.start && dt <= m.end;
        }).length;

        const expiredInMonth = allMembers.filter(mem => {
          if (!mem.subscriptionEndDate) return false;
          const dt = new Date(mem.subscriptionEndDate);
          return dt >= m.start && dt <= m.end;
        }).length;

        return {
          month: m.name,
          joined: joinedInMonth,
          expired: expiredInMonth
        };
      });

      // 3. Region Overview
      const allRegions = await this.regionRepo.find({ where: { isDeleted: false } as any });
      const allStates = await this.stateRepo.find({ where: { isDeleted: false } as any });

      const stateMap = new Map<string, string>();
      allStates.forEach(s => stateMap.set(s._id.toString(), s.name));

      const regionMap = new Map<string, string>();
      allRegions.forEach(r => {
        let name = (r as any).name || (r as any).regionName || (r as any).title;
        if (!name) {
          if (r.areas && r.areas[0]?.name) {
            name = r.areas[0].name;
          } else if (r.state && stateMap.has(r.state.toString())) {
            name = stateMap.get(r.state.toString())!;
          } else {
            name = "Region";
          }
        }
        regionMap.set(r._id.toString(), name);
        if (r.areas && Array.isArray(r.areas)) {
          r.areas.forEach(a => {
            if (a._id) regionMap.set(a._id.toString(), a.name || name);
          });
        }
      });

      const regionCounts = new Map<string, number>();
      allMembers.forEach(m => {
        const rName = m.businessRegion ? (regionMap.get(m.businessRegion.toString()) || m.state || "Other Region") : (m.state || "Unassigned");
        regionCounts.set(rName, (regionCounts.get(rName) || 0) + 1);
      });

      const regionOverview = Array.from(regionCounts.entries())
        .map(([name, count]) => ({ name, value: count, members: count }))
        .sort((a, b) => b.members - a.members)
        .slice(0, 6);

      // 4. Category Overview
      const allCategories = await this.categoryRepo.find({ where: { isDeleted: false } as any });
      const categoryMap = new Map<string, string>();
      allCategories.forEach(c => categoryMap.set(c._id.toString(), c.name));

      const categoryCounts = new Map<string, number>();
      allMembers.forEach(m => {
        const cName = m.businessCategory ? (categoryMap.get(m.businessCategory.toString()) || m.industry || "Other Category") : (m.industry || "General");
        categoryCounts.set(cName, (categoryCounts.get(cName) || 0) + 1);
      });

      const categoryOverview = Array.from(categoryCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Dashboard analytics retrieved successfully",
        data: {
          totalMembers,
          activeMembers,
          expiringSoon,
          expiredMembers,
          todayPost,
          todayAsk,
          todayGive,
          todayRequirement,
          notPosted,
          notAsked,
          notGiven,
          notRequirements,
          oneToOneCount,
          referralCount,
          thankYouSlipCount,
          thankYouSlipAmount,
          charts: {
            trainingTrend,
            membersTrend,
            regionOverview,
            categoryOverview
          },
          filters: {
            preset: preset || "today",
            startDate: startDate ? startDate.toISOString() : null,
            endDate: endDate.toISOString(),
            regionId: regionId || null,
            categoryId: categoryId || null
          }
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
