import {
  JsonController,
  Get,
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member, MemberStatus } from "../../entity/Member";
import { Category, CategoryType, CategoryStatus } from "../../entity/Category";
import { BusinessRegion, BusinessRegionStatus } from "../../entity/BusinessRegion";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { PostModel, PostType } from "../../entity/Post";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";

/**
 * @swagger
 * tags:
 *   name: Website Common
 *   description: Common website statistical and utility APIs
 */

@JsonController("/common")
export class WebsiteCommonController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private postRepo = AppDataSource.getMongoRepository(PostModel);
  private tySlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);

  /**
   * @swagger
   * /website-api/common/stats:
   *   get:
   *     summary: Get overall website statistics metrics
   *     tags: [Website Common]
   *     responses:
   *       200:
   *         description: Website statistics metrics retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: "Website statistics retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     activeMembersCount:
   *                       type: integer
   *                       example: 120
   *                     categoryCount:
   *                       type: integer
   *                       example: 25
   *                     totalRegions:
   *                       type: integer
   *                       example: 45
   *                     directMeetCount:
   *                       type: integer
   *                       example: 121
   *                     recommendationCount:
   *                       type: integer
   *                       example: 80
   *                     requirementsCount:
   *                       type: integer
   *                       example: 60
   *                     businessDoneCount:
   *                       type: integer
   *                       example: 150
   *                     businessDoneAmount:
   *                       type: string
   *                       example: "5M"
   *                     businessAmount:
   *                       type: string
   *                       example: "5M"
   */
  @Get("/stats")
  async getWebsiteStats(@Res() res: any) {
    try {
      // 1. Active Members Count
      const activeMembersCount = await this.memberRepo.count({
        isDeleted: false,
        status: MemberStatus.ACTIVE
      });

      // 2. Category Count (Main Category Count)
      const categoryCount = await this.categoryRepo.count({
        isDeleted: false,
        status: CategoryStatus.ACTIVE,
        type: CategoryType.MAIN
      });

      // 3. Total Regions (Sum of all areas inside Business Regions)
      const regions = await this.businessRegionRepo.find({
        isDeleted: false,
        status: BusinessRegionStatus.ACTIVE
      });
      let totalRegions = 0;
      for (const region of regions) {
        if (Array.isArray(region.areas)) {
          totalRegions += region.areas.length;
        }
      }

      // 4. Direct Meet (OneToOne / 121 count)
      const directMeetCount = await this.oneToOneRepo.count();

      // 5. Recommendation (Referral count)
      const recommendationCount = await this.referralRepo.count();

      // 6. Requirements Count
      const requirementsCount = await this.postRepo.count({
        isDeleted: false,
        type: PostType.REQUIREMENT
      });

      // 7. Business Done (Thank You Slip count and total amount)
      const thankYouSlips = await this.tySlipRepo.find();
      const businessDoneCount = thankYouSlips.length;
      const rawBusinessDoneAmount = thankYouSlips.reduce(
        (sum, slip) => sum + (Number(slip.amount) || 0),
        0
      );

      const businessDoneAmount = formatCompactNumber(rawBusinessDoneAmount);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Website statistics retrieved successfully",
        data: {
          activeMembersCount,
          categoryCount,
          totalRegions,
          directMeetCount,
          recommendationCount,
          requirementsCount,
          businessDoneCount,
          businessDoneAmount: businessDoneAmount,
          businessAmount: businessDoneAmount,
          businessDoneAmountRaw: rawBusinessDoneAmount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}

function formatCompactNumber(num: number): string {
  if (!num || isNaN(num)) return "0";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  const tiers = [
    { threshold: 1e15, suffix: "Q" },
    { threshold: 1e12, suffix: "T" },
    { threshold: 1e9, suffix: "B" },
    { threshold: 1e6, suffix: "M" },
    { threshold: 1e3, suffix: "K" },
  ];

  for (const tier of tiers) {
    if (abs >= tier.threshold) {
      const formatted = (abs / tier.threshold).toFixed(1).replace(/\.0$/, "");
      return `${sign}${formatted}${tier.suffix}`;
    }
  }

  return `${sign}${abs}`;
}
