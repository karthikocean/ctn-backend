import {
  JsonController,
  Get,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { PointHistory } from "../../entity/PointHistory";
import { Member } from "../../entity/Member";
import { BusinessRegion, Area } from "../../entity/BusinessRegion";
import { State } from "../../entity/State";
import { City } from "../../entity/City";
import { Category } from "../../entity/Category";
import { Plan } from "../../entity/Plan";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { ObjectId } from "mongodb";
import { resolveRegions } from "../../utils/region.helper";

@JsonController("/points")
@UseBefore(AuthMiddleware, franchiseFilter)
export class PointHistoryController {
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/admin/points/history:
   *   get:
   *     summary: Get points history statement logs for all members
   *     tags: [Points Ledger]
   */
  @Get("/history")
  async getHistory(@Req() req: any, @Res() res: any) {
    try {
      const memberWhere: any = { isDeleted: false };
      if (req.isFranchise) {
        if (req.franchiseAreaIds && req.franchiseAreaIds.length > 0) {
          memberWhere.businessRegion = { $in: req.franchiseAreaIds };
        } else {
          memberWhere.businessRegion = new ObjectId();
        }
      }

      const members = await this.memberRepo.find({
        where: memberWhere
      });

      const memberMap = new Map<string, Member>();
      members.forEach((m) => {
        memberMap.set(m._id.toString(), m);
      });

      const memberIds = members.map(m => m._id);
      const historyWhere: any = {};
      if (req.isFranchise) {
        historyWhere.memberId = { $in: memberIds };
      }

      const histories = await this.historyRepo.find({
        where: historyWhere,
        order: { createdAt: "DESC" }
      });

      // Populate Areas/Regions
      const regionIds = [
        ...new Set(
          members
            .map(m => m.businessRegion)
            .filter((id): id is ObjectId => !!id && ObjectId.isValid(id))
            .map(id => new ObjectId(id))
        )
      ];

      const areaMap = new Map<string, string>();
      if (regionIds.length > 0) {
        const businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
        const regions = await businessRegionRepo.find({
          where: {
            $or: [
              { _id: { $in: regionIds } },
              { "areas._id": { $in: regionIds } }
            ],
            isDeleted: false
          } as any
        });
        const resolvedRegions = await resolveRegions(regions);
        for (const r of resolvedRegions) {
          if (r._id) {
            areaMap.set(r._id.toString(), r.name || r.city || r.state || "Region");
          }
          if (r.areas && Array.isArray(r.areas)) {
            for (const a of r.areas) {
              if (a._id) {
                areaMap.set(a._id.toString(), a.name);
              }
            }
          }
        }
      }

      const categoryRepo = AppDataSource.getMongoRepository(Category);
      const categoriesList = await categoryRepo.find({
        where: { isDeleted: false }
      });
      const categoryMap = new Map<string, string>();
      categoriesList.forEach((c) => {
        categoryMap.set(c._id.toString(), c.name);
      });

      const planRepo = AppDataSource.getMongoRepository(Plan);
      const plansList = await planRepo.find({
        where: { status: "active" }
      });
      const planMap = new Map<string, string>();
      plansList.forEach((p) => {
        planMap.set(p._id.toString(), p.title);
      });

      const data = histories.map((h) => {
        const mId = h.memberId?.toString();
        const member = memberMap.get(mId);
        const regionName = (member && member.businessRegion)
          ? areaMap.get(member.businessRegion.toString()) || "-"
          : "-";

        const categoryName = (member && member.businessCategory)
          ? categoryMap.get(member.businessCategory.toString()) || "-"
          : "-";

        const planTitle = (member && member.planId)
          ? planMap.get(member.planId.toString()) || member.membershipType || "Basic"
          : (member ? member.membershipType || "Basic" : "Basic");

        return {
          id: h._id.toString(),
          memberId: mId,
          memberName: member ? member.fullName : "Unknown",
          companyName: member ? (member.businessName || "") : "-",
          region: regionName,
          points: h.points,
          category: h.moduleName,
          reason: h.actionType,
          type: h.type || (h.points >= 0 ? "earned" : "spent"),
          date: h.createdAt ? new Date(h.createdAt).toISOString().split("T")[0] : "-",
          memberCategory: categoryName,
          dateOfJoin: (member && member.createdAt) ? new Date(member.createdAt).toISOString().split("T")[0] : "-",
          subscriptionType: planTitle,
          mobileNumber: member ? member.mobileNumber : "-",
          profilePhoto: member ? member.profilePhoto : undefined
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
