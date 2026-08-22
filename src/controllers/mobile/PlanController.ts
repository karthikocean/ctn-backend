import {
  JsonController,
  Get,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Plan } from "../../entity/Plan";
import { Member } from "../../entity/Member";
import { SubscriptionService } from "../../services/subscription.service";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";

@JsonController("/plans")
export class MobilePlanController {
  private planRepo = AppDataSource.getMongoRepository(Plan);

  /**
   * @swagger
   * /mobile-api/plans:
   *   get:
   *     summary: List all active subscription plans (Mobile)
   *     tags: [Mobile Plan]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number (0-indexed)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Number of records per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search query for plan title
   *     responses:
   *       200:
   *         description: List of active plans retrieved successfully
   */
  @Get("/")
  @UseBefore(MobileAuthMiddleware)
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Req() req: any,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const memberId = req.user?.userId || req.user?.id;
      const where: any = { isDeleted: false, status: "active" };
      if (search) {
        where.title = { $regex: search, $options: "i" };
      }

      const [plans, total] = await this.planRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { sort: "ASC" }
      });

      let hasUsedTrial = false;
      let currentPlanId: string | null = null;
      let currentPlanAmount = 0;
      let isCurrentSubTrial = false;
      let refferalUserFlag = false;

      if (memberId) {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        const member = await memberRepo.findOneBy({ _id: new ObjectId(memberId), isDeleted: false });
        if (member) {
          // If member has referredBy present, set refferalUserFlag = true
          refferalUserFlag = Boolean(member.referredBy);
          hasUsedTrial = member.hasUsedTrial || false;
          const subService = new SubscriptionService();
          const activeSub = await subService.getActiveSubscription(member._id);
          if (activeSub && activeSub.status === "ACTIVE") {
            currentPlanId = activeSub.planId ? activeSub.planId.toString() : null;
            isCurrentSubTrial = activeSub.isTrial || false;
            if (activeSub.planId) {
              const currentPlan = await this.planRepo.findOneBy({ _id: activeSub.planId });
              if (currentPlan) {
                currentPlanAmount = currentPlan.amount;
              }
            }
          }
        }
      }

      // If user has chosen trial (hasUsedTrial or isCurrentSubTrial), show isTrial = true for entire plans
      const userHasChoosedTrial = Boolean(hasUsedTrial || isCurrentSubTrial);

      // Map plans to include action, isTrial, isTrail, refferalUserFlag, and adjust trialDays to 10 if referral user
      const mappedPlans = plans.map(p => {
        const effectiveTrialDays = refferalUserFlag ? 10 : (p.trialDays ?? 0);
        let action: string | null = "Get Trial";
        const isTrial = userHasChoosedTrial;

        if (memberId) {
          if (!userHasChoosedTrial) {
            action = (effectiveTrialDays > 0) ? "Get Trial" : "Upgrade";
          } else {
            if (currentPlanId === p._id.toString()) {
              if (isCurrentSubTrial) {
                action = "Buy";
              } else {
                action = "Current";
              }
            } else {
              if (isCurrentSubTrial) {
                action = "Buy";
              } else {
                action = (!currentPlanId) ? "Buy" : (p.amount > currentPlanAmount) ? "Upgrade" : "Downgrade";
              }
            }
          }
        }

        return {
          ...p,
          trialDays: effectiveTrialDays,
          refferalUserFlag,
          // isTrial,
          isTrail: isTrial, // support both spellings for client compatibility
          action
        };
      });

      return pagination(total, mappedPlans, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/plans/{id}:
   *   get:
   *     summary: Get single active plan details (Mobile)
   *     tags: [Mobile Plan]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The plan ID
   *     responses:
   *       200:
   *         description: Plan details retrieved successfully
   *       404:
   *         description: Plan not found
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Req() req: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const plan = await this.planRepo.findOneBy({
        _id: new ObjectId(id),
        status: "active",
        isDeleted: false
      });

      if (!plan) throw new NotFoundError("Plan not found");

      let refferalUserFlag = false;
      let hasUsedTrial = false;
      let isCurrentSubTrial = false;
      const memberId = req.user?.userId || req.user?.id;

      if (memberId && ObjectId.isValid(memberId)) {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        const member = await memberRepo.findOneBy({ _id: new ObjectId(memberId), isDeleted: false });
        if (member) {
          refferalUserFlag = Boolean(member.referredBy);
          hasUsedTrial = member.hasUsedTrial || false;
          const subService = new SubscriptionService();
          const activeSub = await subService.getActiveSubscription(member._id);
          if (activeSub && activeSub.status === "ACTIVE") {
            isCurrentSubTrial = activeSub.isTrial || false;
          }
        }
      }

      const userHasChoosedTrial = Boolean(hasUsedTrial || isCurrentSubTrial);
      const effectiveTrialDays = refferalUserFlag ? 10 : (plan.trialDays ?? 0);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...plan,
          trialDays: effectiveTrialDays,
          refferalUserFlag,
          isTrial: userHasChoosedTrial,
          isTrail: userHasChoosedTrial
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
