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
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { ReferralService } from "../../services/referral.service";
import { ApplyReferralDto, ReferralHistoryQueryDto } from "../../dto/mobile/Referral.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { AppDataSource } from "../../data-source";
import { Member } from "../../entity/Member";

@JsonController("/referrals")
@UseBefore(MobileAuthMiddleware)
export class MobileReferralController {
  private referralService = new ReferralService();
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /mobile-api/referrals/me:
   *   get:
   *     summary: Get my referral code, deep link, and overall referral statistics
   *     tags: [Mobile Referrals]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Referral info retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     referralCode:
   *                       type: string
   *                       example: "ANBU8F42"
   *                     referralLink:
   *                       type: string
   *                       example: "https://trustednetwork.in/ref/ANBU8F42"
   *                     totalReferrals:
   *                       type: integer
   *                       example: 10
   *                     successfulReferrals:
   *                       type: integer
   *                       example: 8
   *                     pendingReferrals:
   *                       type: integer
   *                       example: 2
   *                     totalRewards:
   *                       type: integer
   *                       example: 400
   *       401:
   *         description: Unauthorized
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
   * /mobile-api/referrals/list:
   *   get:
   *     summary: Get paginated referral list for the current member
   *     tags: [Mobile Referrals]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [PENDING, COMPLETED, CANCELLED]
   *       - in: query
   *         name: sort
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *           default: desc
   *     responses:
   *       200:
   *         description: Referral list retrieved successfully
   */
  @Get("/list")
  @HttpCode(StatusCodes.OK)
  async getReferralList(
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
   * /mobile-api/referrals/apply:
   *   post:
   *     summary: Apply a referral code post-registration (if member has no referrer yet)
   *     tags: [Mobile Referrals]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ApplyReferralDto'
   *     responses:
   *       200:
   *         description: Referral applied successfully
   *       400:
   *         description: Validation or self-referral error
   *       401:
   *         description: Unauthorized
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
