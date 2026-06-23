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
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { ObjectId } from "mongodb";

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
      const stateCities = members
        .filter(m => m.state && m.city && m.businessRegion)
        .map(m => ({ state: m.state!, city: m.city! }));

      const uniqueStateCitiesMap = new Map<string, { state: string, city: string }>();
      for (const sc of stateCities) {
        uniqueStateCitiesMap.set(`${sc.state.toLowerCase()}|${sc.city.toLowerCase()}`, sc);
      }
      const uniqueStateCities = Array.from(uniqueStateCitiesMap.values());
      const stateNames = uniqueStateCities.map(sc => sc.state);
      const cityNames = uniqueStateCities.map(sc => sc.city);

      const stateRepo = AppDataSource.getMongoRepository(State);
      const cityRepo = AppDataSource.getMongoRepository(City);
      const businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);

      const matchingStates = stateNames.length > 0
        ? await stateRepo.find({
          where: {
            name: { $in: stateNames.map(name => new RegExp(`^${name}$`, "i")) },
            isDeleted: false
          }
        })
        : [];

      const matchingCities = cityNames.length > 0
        ? await cityRepo.find({
          where: {
            name: { $in: cityNames.map(name => new RegExp(`^${name}$`, "i")) },
            isDeleted: false
          }
        })
        : [];

      const stateIdMap = new Map(matchingStates.map(s => [s._id.toString(), s.name.toLowerCase()]));
      const cityIdMap = new Map(matchingCities.map(c => [c._id.toString(), c.name.toLowerCase()]));

      const stateIds = matchingStates.map(s => s._id);
      const cityIds = matchingCities.map(c => c._id);

      const regions = (stateIds.length > 0 && cityIds.length > 0)
        ? await businessRegionRepo.find({
          where: {
            state: { $in: stateIds },
            city: { $in: cityIds },
            isDeleted: false
          } as any
        })
        : [];

      const regionMap = new Map<string, Area[]>();
      for (const r of regions) {
        const stateName = stateIdMap.get(r.state.toString()) || "";
        const cityName = cityIdMap.get(r.city.toString()) || "";
        regionMap.set(`${stateName}|${cityName}`, r.areas || []);
      }

      const data = histories.map((h) => {
        const mId = h.memberId?.toString();
        const member = memberMap.get(mId);
        let regionName = "-";
        if (member && member.businessRegion && member.state && member.city) {
          const areasList = regionMap.get(`${member.state.toLowerCase()}|${member.city.toLowerCase()}`) || [];
          const matchedArea = areasList.find(a => a._id?.toString() === member.businessRegion!.toString());
          if (matchedArea) {
            regionName = matchedArea.name;
          }
        }
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
          date: h.createdAt ? new Date(h.createdAt).toISOString().split("T")[0] : "-"
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
