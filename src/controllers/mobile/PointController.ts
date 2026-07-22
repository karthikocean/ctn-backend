import {
  JsonController,
  Get,
  QueryParam,
  Req,
  Res,
  UseBefore,
  NotFoundError,
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member } from "../../entity/Member";
import { PointHistory } from "../../entity/PointHistory";
import { DailyScoreHistory } from "../../entity/DailyScoreHistory";
import { PointConfig } from "../../entity/PointConfig";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { pagination } from "../../utils";

@JsonController("/points")
@UseBefore(MobileAuthMiddleware)
export class MobilePointController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);
  private dailyScoreHistoryRepo = AppDataSource.getMongoRepository(DailyScoreHistory);

  /**
   * @swagger
   * /mobile-api/points/insights:
   *   get:
   *     summary: Get points performance insights for the current member
   *     tags: [Mobile Points]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/insights")
  async getInsights(@Req() req: any, @Res() res: any) {
    try {
      const memberId = new ObjectId(req.user.userId);

      const member = await this.memberRepo.findOneBy({ _id: memberId, isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      const activeBalance = member.points || 0;

      // 1. Calculate points earned this month
      const IST_OFFSET = 5.5 * 60 * 60 * 1000; // UTC+05:30
      const istStartOfMonth = new Date(new Date().getTime() + IST_OFFSET);
      istStartOfMonth.setUTCDate(1);
      istStartOfMonth.setUTCHours(0, 0, 0, 0);
      const startOfMonth = new Date(istStartOfMonth.getTime() - IST_OFFSET);

      const historyThisMonth = await this.historyRepo.find({
        where: {
          memberId,
          points: { $gt: 0 },
          createdAt: { $gte: startOfMonth }
        } as any
      });
      const earnedThisMonth = historyThisMonth.reduce((sum, h) => sum + (h.points || 0), 0);

      // Get local date string YYYY-MM-DD
      const now = new Date(new Date().getTime() + IST_OFFSET);
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const day = String(now.getUTCDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;

      const todayScoreHistory = await this.dailyScoreHistoryRepo.find({
        where: {
          memberId,
          date: dateStr
        } as any
      });

      const checklistModules = ["Post", "Ask", "Give", "Requirement", "Milestone"];
      const todayHistory = checklistModules.map(moduleName => {
        const found = todayScoreHistory.find(h => h.moduleName === moduleName);
        return {
          moduleName,
          score: found ? found.score : 0,
          createdAt: found ? found.createdAt : null
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          activeBalance,
          earnedThisMonth,
          dailyScore: member.dailyScore || 0,
          todayHistory
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/points/daily-history:
   *   get:
   *     summary: Get member daily score checklist history by date or month
   *     tags: [Mobile Points]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: month
   *         description: Month filter in YYYY-MM format
   *         schema:
   *           type: string
   *       - in: query
   *         name: date
   *         description: Date filter in YYYY-MM-DD format
   *         schema:
   *           type: string
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/daily-history")
  async getDailyHistory(
    @Req() req: any,
    @QueryParam("month") month: string,
    @QueryParam("date") date: string,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @Res() res: any
  ) {
    try {
      const memberId = new ObjectId(req.user.userId);
      const page = Number(pageParam) || 0;
      const limit = Number(limitParam) || 30;

      let dateStrings: string[] = [];
      let total = 0;

      if (date) {
        // Single date filter
        dateStrings = [date];
        total = 1;
      } else if (month) {
        // Month filter (e.g. YYYY-MM)
        const parts = month.split("-");
        if (parts.length !== 2) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            message: "Invalid month format. Expected YYYY-MM."
          });
        }
        const yr = parseInt(parts[0]);
        const mn = parseInt(parts[1]) - 1;
        if (isNaN(yr) || isNaN(mn) || mn < 0 || mn > 11) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            message: "Invalid month value."
          });
        }

        const daysInMonth = new Date(yr, mn + 1, 0).getDate();
        const allMonthDates: string[] = [];
        for (let i = daysInMonth; i >= 1; i--) {
          const dayStr = String(i).padStart(2, "0");
          allMonthDates.push(`${parts[0]}-${parts[1]}-${dayStr}`);
        }

        total = allMonthDates.length;
        dateStrings = allMonthDates.slice(page * limit, (page + 1) * limit);
      } else {
        // Default past days starting from today (up to 1 year back)
        const IST_OFFSET = 5.5 * 60 * 60 * 1000; // UTC+05:30
        const today = new Date(new Date().getTime() + IST_OFFSET);
        total = 365;

        const offsetStart = page * limit;
        for (let i = 0; i < limit; i++) {
          const targetDate = new Date(today.getTime());
          targetDate.setUTCDate(today.getUTCDate() - (offsetStart + i));

          const yr = targetDate.getUTCFullYear();
          const mn = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
          const dy = String(targetDate.getUTCDate()).padStart(2, "0");
          dateStrings.push(`${yr}-${mn}-${dy}`);
        }
      }

      // Fetch histories for this member for the calculated dateStrings
      const histories = await this.dailyScoreHistoryRepo.find({
        where: {
          memberId,
          date: { $in: dateStrings }
        } as any
      });

      // Build date range boundaries for PointHistory count aggregation
      const datesSorted = [...dateStrings].sort();
      const rangeStart = new Date(`${datesSorted[0]}T00:00:00.000Z`);
      const rangeEnd = new Date(`${datesSorted[datesSorted.length - 1]}T23:59:59.999Z`);

      // Aggregate PointHistory counts grouped by date string + moduleName
      const pointCountAgg = await this.historyRepo.aggregate([
        {
          $match: {
            memberId,
            type: "earned",
            createdAt: { $gte: rangeStart, $lte: rangeEnd }
          }
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:30" }
              },
              moduleName: "$moduleName"
            },
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      // Build lookup map: date -> moduleName -> count
      // Normalize raw PointHistory module names to match checklist names
      const normalizeForChecklist = (raw: string): string => {
        const n = raw.toLowerCase().trim();
        if (n === "post" || n === "promotion") return "Post";
        if (n === "ask") return "Ask";
        if (n === "give") return "Give";
        if (n === "requirement" || n === "requirements") return "Requirement";
        if (n === "milestone" || n === "milestones" || n === "mile stone") return "Milestone";
        return raw;
      };

      const countMap: Record<string, Record<string, number>> = {};
      for (const row of pointCountAgg) {
        const d = row._id.date;
        const m = normalizeForChecklist(row._id.moduleName);
        if (!countMap[d]) countMap[d] = {};
        countMap[d][m] = (countMap[d][m] || 0) + row.count;
      }

      const checklistModules = ["Post", "Ask", "Give", "Requirement", "Milestone"];

      const results = dateStrings.map(dateStr => {
        const dayLogs = histories.filter(h => h.date === dateStr);
        const dailyScore = dayLogs.reduce((sum, h) => sum + (h.score || 0), 0);

        const history = checklistModules.map(moduleName => {
          const found = dayLogs.find(h => h.moduleName === moduleName);
          const count = countMap[dateStr]?.[moduleName] ?? 0;
          return {
            moduleName,
            score: found ? found.score : 0,
            count,
            createdAt: found ? found.createdAt : null
          };
        });

        return {
          date: dateStr,
          dailyScore,
          history
        };
      });

      return pagination(total, results, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/points/statement:
   *   get:
   *     summary: Get transaction points statement history
   *     tags: [Mobile Points]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [all, earned, spent]
   *       - in: query
   *         name: moduleName
   *         schema:
   *           type: string
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/statement")
  async getStatement(
    @Req() req: any,
    @QueryParam("type") type: string,
    @QueryParam("moduleName") moduleName: string,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @Res() res: any
  ) {
    try {
      const memberId = new ObjectId(req.user.userId);
      const page = Number(pageParam) || 0;
      const limit = Number(limitParam) || 10;

      const member = await this.memberRepo.findOneBy({ _id: memberId, isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      const filter: any = { memberId };
      if (type === "earned") {
        filter.$or = [
          { type: "earned" },
          { type: { $exists: false }, points: { $gt: 0 } }
        ];
      } else if (type === "spent") {
        filter.$or = [
          { type: "spent" },
          { type: { $exists: false }, points: { $lt: 0 } }
        ];
      }

      if (moduleName) {
        filter.moduleName = { $regex: new RegExp(`^${moduleName}$`, "i") };
      }

      const [history, total] = await this.historyRepo.findAndCount({
        where: filter,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });
      return pagination(total, history, limit, page, res);

    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/points/configs:
   *   get:
   *     summary: Get all point configurations
   *     tags: [Mobile Points]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: moduleName
   *         schema:
   *           type: string
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [creation, response, spent]
   */
  @Get("/configs")
  async getConfigs(
    @QueryParam("moduleName") moduleName: string,
    @QueryParam("type") type: string,
    @Res() res: any
  ) {
    try {
      const configRepo = AppDataSource.getMongoRepository(PointConfig);
      const where: any = { isDeleted: false };

      if (moduleName) {
        where.moduleName = { $regex: new RegExp(`^${moduleName}$`, "i") };
      }

      if (type) {
        where.type = type;
      }

      const configs = await configRepo.find({ where });
      return res.status(StatusCodes.OK).json({
        success: true,
        data: configs
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
