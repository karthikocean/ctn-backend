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
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const historyThisMonth = await this.historyRepo.find({
        where: {
          memberId,
          points: { $gt: 0 },
          createdAt: { $gte: startOfMonth }
        } as any
      });
      const earnedThisMonth = historyThisMonth.reduce((sum, h) => sum + (h.points || 0), 0);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          activeBalance,
          earnedThisMonth,
        }
      });
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

      const [history, total] = await this.historyRepo.findAndCount({
        where: filter,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });
      return pagination(total, history, page, limit, res);

    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
