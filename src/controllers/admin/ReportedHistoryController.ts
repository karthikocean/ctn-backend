import { JsonController, Get, QueryParam, Res, UseBefore } from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { ReportedHistory } from "../../entity/ReportedHistory";
import { Member } from "../../entity/Member";
import { ObjectId } from "mongodb";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { pagination } from "../../utils";

@JsonController("/reported-history")
@UseBefore(AuthMiddleware)
export class ReportedHistoryController {
  private reportRepo = AppDataSource.getMongoRepository(ReportedHistory);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  @Get("/")
  async getAllReports(
    @QueryParam("page") page: number = 0,
    @QueryParam("limit") limit: number = 20,
    @Res() res: any
  ) {
    try {
      // 1. Fetch reported history with pagination
      const [reports, total] = await this.reportRepo.findAndCount({
        order: { createdAt: "DESC" },
        take: limit,
        skip: page * limit
      });

      // 2. Get all unique member IDs
      const memberIds: ObjectId[] = [];
      reports.forEach(r => {
        if (r.reporterUserId) memberIds.push(r.reporterUserId);
        if (r.targetUserId) memberIds.push(r.targetUserId);
      });

      // 3. Fetch member details for those IDs
      const members = await this.memberRepo.find({
        where: { _id: { $in: memberIds } } as any,
        select: ["_id", "fullName", "profilePhoto", "mobileNumber"]
      });

      // 4. Create a map for quick lookup
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      // 5. Populate names in the result
      const results = reports.map(report => {
        const reporter = memberMap.get(report.reporterUserId?.toString());
        const target = memberMap.get(report.targetUserId?.toString());

        return {
          ...report,
          reporterName: reporter ? reporter.fullName : "Unknown",
          targetName: target ? target.fullName : "Unknown",
          reporterMobile: reporter ? reporter.mobileNumber : null,
          targetMobile: target ? target.mobileNumber : null
        };
      });

      return pagination(total, results, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
