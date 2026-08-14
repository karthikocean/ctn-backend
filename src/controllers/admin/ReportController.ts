import {
  JsonController,
  Get,
  QueryParam,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member } from "../../entity/Member";
import { Plan } from "../../entity/Plan";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { MemberSubscription } from "../../entity/MemberSubscription";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/reports")
@UseBefore(AuthMiddleware, franchiseFilter, canAccess("reports", "view"))
export class AdminReportController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private subRepo = AppDataSource.getMongoRepository(MemberSubscription);

  /**
   * Helper to build a map of area ID / region ID -> region/area name
   */
  private async buildRegionMap(): Promise<Map<string, string>> {
    const regions = await this.regionRepo.find({ where: { isDeleted: false } as any });
    const regionMap = new Map<string, string>();

    regions.forEach(r => {
      if (r.areas && Array.isArray(r.areas)) {
        r.areas.forEach((area: any) => {
          if (area._id) {
            regionMap.set(area._id.toString(), area.name || "Region");
          }
        });
      }
      if (r._id) {
        regionMap.set(
          r._id.toString(),
          (r as any).name || (r as any).regionName || (r.areas && r.areas[0]?.name) || "Region"
        );
      }
    });

    return regionMap;
  }

  /**
   * @swagger
   * /api/admin/reports/subscription-renewals:
   *   get:
   *     summary: Subscription Renewal List Report (Paid / Premium Plans)
   *     tags: [Admin Reports]
   */
  @Get("/subscription-renewals")
  async getSubscriptionRenewals(
    @Req() req: any,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("search") search: string,
    @QueryParam("status") statusFilter: string,
    @QueryParam("regionId") regionId: string,
    @QueryParam("planId") planId: string,
    @QueryParam("startDate") startDateParam: string,
    @QueryParam("endDate") endDateParam: string,
    @QueryParam("fromDate") fromDateParam: string,
    @QueryParam("toDate") toDateParam: string,
    @Res() res: any
  ) {
    try {
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(50000, Number(limitParam) || 10);

      // 1. Get all plans for fallback naming details
      const allPlans = await this.planRepo.find({ where: { isDeleted: false } as any });
      const planMap = new Map(allPlans.map(p => [p._id.toString(), p]));

      // 2. Fetch regions map matching both area._id and region._id
      const regionMap = await this.buildRegionMap();

      // 3. Query premium member subscriptions from member_subscriptions
      const premiumSubs = await this.subRepo.find({
        where: {
          status: { $in: ["ACTIVE", "Active"] } as any,
          isTrial: { $ne: true } as any,
          isDeleted: false
        }
      });

      // Keep only the latest subscription per member (by endDate)
      const subMap = new Map<string, MemberSubscription>();
      premiumSubs.forEach(sub => {
        const mId = sub.memberId.toString();
        const existing = subMap.get(mId);
        if (!existing || new Date(sub.endDate) > new Date(existing.endDate)) {
          subMap.set(mId, sub);
        }
      });

      const latestPremiumSubs = Array.from(subMap.values());
      let filteredSubs = latestPremiumSubs;
      if (planId && ObjectId.isValid(planId)) {
        const planOidStr = planId.toString();
        filteredSubs = filteredSubs.filter(s => s.planId?.toString() === planOidStr);
      }
      const filteredMemberIds = filteredSubs.map(s => s.memberId);

      // 4. Build Member query filter
      const matchFilter: any = {
        isDeleted: false
      };

      let finalMemberIds = filteredMemberIds;
      if (req.isFranchise && req.franchiseMemberIds && Array.isArray(req.franchiseMemberIds)) {
        const franchiseIdStrs = new Set(req.franchiseMemberIds.map((id: any) => id.toString()));
        finalMemberIds = finalMemberIds.filter(id => franchiseIdStrs.has(id.toString()));
      }

      if (finalMemberIds.length === 0) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: {
            total: 0,
            page,
            limit,
            totalPages: 0,
            summary: {
              total: 0,
              dueSoon: 0,
              expired: 0,
              active: 0
            },
            list: []
          }
        });
      }

      const finalMemberOids = finalMemberIds.map(id => new ObjectId(id.toString()));
      matchFilter._id = { $in: finalMemberOids } as any;

      if (req.isFranchise && req.franchiseAreaIds && Array.isArray(req.franchiseAreaIds) && req.franchiseAreaIds.length > 0) {
        matchFilter.businessRegion = { $in: req.franchiseAreaIds };
      }

      if (regionId && ObjectId.isValid(regionId)) {
        matchFilter.businessRegion = new ObjectId(regionId);
      }

      if (search && search.trim()) {
        const regex = { $regex: search.trim(), $options: "i" };
        matchFilter.$or = [
          { fullName: regex },
          { mobileNumber: regex },
          { email: regex },
          { businessName: regex }
        ];
      }

      // Fetch matching members
      const allMatchingMembers = await this.memberRepo.find({
        where: matchFilter
      });

      const subInfoMap = new Map<string, MemberSubscription>(
        filteredSubs.map(s => [s.memberId.toString(), s])
      );

      const now = new Date();

      // Transform & calculate status and days remaining
      const transformed = allMatchingMembers.map(m => {
        const sub = subInfoMap.get(m._id.toString());
        if (!sub) return null;
        const plan = sub.planId ? planMap.get(sub.planId.toString()) : null;
        const regionName = m.businessRegion ? regionMap.get(m.businessRegion.toString()) || "N/A" : "N/A";
        const expiryDate = sub.endDate ? new Date(sub.endDate) : null;

        let daysRemaining = 0;
        let subStatus = "ACTIVE";

        if (expiryDate) {
          const diffMs = expiryDate.getTime() - now.getTime();
          daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          if (daysRemaining < 0) {
            subStatus = "EXPIRED";
          } else if (daysRemaining <= 7) {
            subStatus = "DUE_SOON";
          } else {
            subStatus = "ACTIVE";
          }
        }

        return {
          memberId: m._id,
          fullName: m.fullName || "N/A",
          profilePhoto: m.profilePhoto || null,
          mobileNumber: m.mobileNumber || "N/A",
          email: m.email || "N/A",
          businessName: m.businessName || "N/A",
          regionId: m.businessRegion,
          regionName,
          planId: sub.planId,
          planName: plan?.title || "Premium Plan",
          billingCycle: plan?.billingCycle || "yearly",
          amount: plan?.amount || 0,
          startDate: sub.startDate || null,
          endDate: sub.endDate || null,
          daysRemaining,
          status: subStatus
        };
      }).filter(Boolean) as any[];

      // Sort by renewal date ascending
      transformed.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
        return dateA - dateB;
      });

      // Filter by status if requested
      let filtered = transformed;
      if (statusFilter && statusFilter !== "ALL") {
        filtered = transformed.filter(item => item.status === statusFilter);
      }

      // Filter by Date Range (From Date & To Date)
      const fromDateVal = startDateParam || fromDateParam;
      const toDateVal = endDateParam || toDateParam;

      if (fromDateVal || toDateVal) {
        const startBoundary = fromDateVal ? new Date(fromDateVal) : null;
        if (startBoundary) startBoundary.setHours(0, 0, 0, 0);

        const endBoundary = toDateVal ? new Date(toDateVal) : null;
        if (endBoundary) endBoundary.setHours(23, 59, 59, 999);

        filtered = filtered.filter(item => {
          const checkDateStr = item.endDate || item.startDate;
          if (!checkDateStr) return false;
          const expDate = new Date(checkDateStr);
          if (isNaN(expDate.getTime())) return false;

          if (startBoundary && expDate.getTime() < startBoundary.getTime()) {
            return false;
          }
          if (endBoundary && expDate.getTime() > endBoundary.getTime()) {
            return false;
          }
          return true;
        });
      }

      // Calculate Summary Metrics
      const totalCount = filtered.length;
      const dueSoonCount = transformed.filter(i => i.status === "DUE_SOON").length;
      const expiredCount = transformed.filter(i => i.status === "EXPIRED").length;
      const activeCount = transformed.filter(i => i.status === "ACTIVE").length;

      // Apply pagination
      const pagedData = filtered.slice(page * limit, (page + 1) * limit);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          summary: {
            total: transformed.length,
            dueSoon: dueSoonCount,
            expired: expiredCount,
            active: activeCount
          },
          list: pagedData
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/reports/free-subscription-endings:
   *   get:
   *     summary: Free Subscription Ending List Report (Trial / Free Plans)
   *     tags: [Admin Reports]
   */
  @Get("/free-subscription-endings")
  async getFreeSubscriptionEndings(
    @Req() req: any,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("search") search: string,
    @QueryParam("status") statusFilter: string,
    @QueryParam("regionId") regionId: string,
    @QueryParam("planId") planId: string,
    @QueryParam("startDate") startDateParam: string,
    @QueryParam("endDate") endDateParam: string,
    @QueryParam("fromDate") fromDateParam: string,
    @QueryParam("toDate") toDateParam: string,
    @Res() res: any
  ) {
    try {
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(50000, Number(limitParam) || 10);

      // 1. Find all plans for fallback naming details
      const allPlans = await this.planRepo.find({ where: { isDeleted: false } as any });
      const planMap = new Map(allPlans.map(p => [p._id.toString(), p]));

      // 2. Fetch regions map matching both area._id and region._id
      const regionMap = await this.buildRegionMap();

      // 3. Query trial subscriptions from member_subscriptions
      const freeSubs = await this.subRepo.find({
        where: {
          isTrial: true,
          isDeleted: false,
          status: "ACTIVE"
        }
      });

      // Keep only the latest subscription per member (by endDate)
      const subMap = new Map<string, MemberSubscription>();
      freeSubs.forEach(sub => {
        const mId = sub.memberId.toString();
        const existing = subMap.get(mId);
        if (!existing || new Date(sub.endDate) > new Date(existing.endDate)) {
          subMap.set(mId, sub);
        }
      });

      const latestFreeSubs = Array.from(subMap.values());
      let filteredSubs = latestFreeSubs;
      if (planId && ObjectId.isValid(planId)) {
        const planOidStr = planId.toString();
        filteredSubs = filteredSubs.filter(s => s.planId?.toString() === planOidStr);
      }
      const filteredMemberIds = filteredSubs.map(s => s.memberId);

      // 4. Build Member filter query
      const matchFilter: any = {
        isDeleted: false
      };

      let finalMemberIds = filteredMemberIds;
      if (req.isFranchise && req.franchiseMemberIds && Array.isArray(req.franchiseMemberIds)) {
        const franchiseIdStrs = new Set(req.franchiseMemberIds.map((id: any) => id.toString()));
        finalMemberIds = finalMemberIds.filter(id => franchiseIdStrs.has(id.toString()));
      }

      if (finalMemberIds.length === 0) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: {
            total: 0,
            page,
            limit,
            totalPages: 0,
            summary: {
              total: 0,
              endingSoon: 0,
              expired: 0,
              activeTrial: 0
            },
            list: []
          }
        });
      }

      const finalMemberOids = finalMemberIds.map(id => new ObjectId(id.toString()));
      matchFilter._id = { $in: finalMemberOids } as any;

      if (req.isFranchise && req.franchiseAreaIds && Array.isArray(req.franchiseAreaIds) && req.franchiseAreaIds.length > 0) {
        matchFilter.businessRegion = { $in: req.franchiseAreaIds };
      }

      if (regionId && ObjectId.isValid(regionId)) {
        matchFilter.businessRegion = new ObjectId(regionId);
      }

      if (search && search.trim()) {
        const regex = { $regex: search.trim(), $options: "i" };
        matchFilter.$or = [
          { fullName: regex },
          { mobileNumber: regex },
          { email: regex },
          { businessName: regex }
        ];
      }

      const allMatchingMembers = await this.memberRepo.find({
        where: matchFilter
      });

      const subInfoMap = new Map<string, MemberSubscription>(
        filteredSubs.map(s => [s.memberId.toString(), s])
      );

      const now = new Date();

      const transformed = allMatchingMembers.map(m => {
        const sub = subInfoMap.get(m._id.toString());
        if (!sub) return null;
        const plan = sub.planId ? planMap.get(sub.planId.toString()) : null;
        const regionName = m.businessRegion ? regionMap.get(m.businessRegion.toString()) || "N/A" : "N/A";
        const expiryDate = sub.endDate ? new Date(sub.endDate) : null;

        let daysRemaining = 0;
        let subStatus = "ACTIVE_TRIAL";

        if (expiryDate) {
          const diffMs = expiryDate.getTime() - now.getTime();
          daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          if (daysRemaining < 0) {
            subStatus = "EXPIRED";
          } else if (daysRemaining <= 7) {
            subStatus = "ENDING_SOON";
          } else {
            subStatus = "ACTIVE_TRIAL";
          }
        }

        return {
          memberId: m._id,
          fullName: m.fullName || "N/A",
          profilePhoto: m.profilePhoto || null,
          mobileNumber: m.mobileNumber || "N/A",
          email: m.email || "N/A",
          businessName: m.businessName || "N/A",
          regionId: m.businessRegion,
          regionName,
          planId: sub.planId,
          planName: plan?.title || "Free Trial",
          trialDays: plan?.trialDays || 30,
          startDate: sub.startDate || null,
          endDate: sub.endDate || null,
          daysRemaining,
          status: subStatus
        };
      }).filter(Boolean) as any[];

      // Sort by expiry date ascending
      transformed.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
        return dateA - dateB;
      });

      let filtered = transformed;
      if (statusFilter && statusFilter !== "ALL") {
        filtered = transformed.filter(item => item.status === statusFilter);
      }

      // Filter by Date Range (From Date & To Date)
      const fromDateVal = startDateParam || fromDateParam;
      const toDateVal = endDateParam || toDateParam;

      if (fromDateVal || toDateVal) {
        const startBoundary = fromDateVal ? new Date(fromDateVal) : null;
        if (startBoundary) startBoundary.setHours(0, 0, 0, 0);

        const endBoundary = toDateVal ? new Date(toDateVal) : null;
        if (endBoundary) endBoundary.setHours(23, 59, 59, 999);

        filtered = filtered.filter(item => {
          if (!item.endDate) return false;
          const expDate = new Date(item.endDate);
          if (isNaN(expDate.getTime())) return false;

          if (startBoundary && expDate.getTime() < startBoundary.getTime()) {
            return false;
          }
          if (endBoundary && expDate.getTime() > endBoundary.getTime()) {
            return false;
          }
          return true;
        });
      }

      const totalCount = filtered.length;
      const endingSoonCount = transformed.filter(i => i.status === "ENDING_SOON").length;
      const expiredCount = transformed.filter(i => i.status === "EXPIRED").length;
      const activeTrialCount = transformed.filter(i => i.status === "ACTIVE_TRIAL").length;

      const pagedData = filtered.slice(page * limit, (page + 1) * limit);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          summary: {
            total: transformed.length,
            endingSoon: endingSoonCount,
            expired: expiredCount,
            activeTrial: activeTrialCount
          },
          list: pagedData
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
