import {
  JsonController,
  Get,
  Post,
  Body,
  QueryParams,
  Req,
  Res,
  UseBefore,
  HttpCode,
  BadRequestError,
  NotFoundError
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { ObjectId } from "mongodb";
import { MobileAuthMiddleware } from "../middlewares/MobileAuthMiddleware";
import { ReferralService } from "../services/referral.service";
import { ApplyReferralDto, ReferralHistoryQueryDto } from "../dto/mobile/Referral.dto";
import handleErrorResponse from "../utils/commonFunction";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";

@JsonController("/referrals")
@UseBefore(MobileAuthMiddleware)
export class ReferralController {
  private referralService = new ReferralService();
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/referrals/me:
   *   get:
   *     summary: Get my referral code, deep link, and overall referral statistics
   *     tags: [Referrals]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Referral info retrieved successfully
   */
  @Get("/me")
  @HttpCode(StatusCodes.OK)
  async getMyReferralInfo(@Req() req: any, @Res() res: any) {
    try {
      const memberId = new ObjectId(req.user.userId || req.user.id);
      const referralInfo = await this.referralService.getMyReferralInfo(memberId);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: referralInfo
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/referrals/history:
   *   get:
   *     summary: Get paginated referral history for the current member
   *     tags: [Referrals]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Referral history retrieved successfully
   */
  @Get("/history")
  @HttpCode(StatusCodes.OK)
  async getReferralHistory(
    @Req() req: any,
    @QueryParams() query: ReferralHistoryQueryDto,
    @Res() res: any
  ) {
    try {
      const memberId = new ObjectId(req.user.userId || req.user.id);
      const result = await this.referralService.getReferralHistory(memberId, query);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: result.referrals,
        pagination: result.pagination
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/referrals/apply:
   *   post:
   *     summary: Apply a referral code post-registration
   *     tags: [Referrals]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Referral applied successfully
   */
  @Post("/apply")
  @HttpCode(StatusCodes.OK)
  async applyReferral(
    @Req() req: any,
    @Body() body: ApplyReferralDto,
    @Res() res: any
  ) {
    try {
      const memberId = new ObjectId(req.user.userId || req.user.id);
      const member = await this.memberRepo.findOneBy({ _id: memberId, isDeleted: false });

      if (!member) {
        throw new NotFoundError("Member not found");
      }

      if (member.referredBy) {
        throw new BadRequestError("You already have an active referrer and cannot change it.");
      }

      const result = await this.referralService.processReferral({
        referredMember: member,
        referralCode: body.referralCode
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Referral applied successfully",
        data: {
          referrerReward: result.referrerReward,
          referredReward: result.referredReward,
          status: result.userReferral.status
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
