import {
  JsonController,
  Get,
  Post,
  Body,
  Res,
  Req,
  UseBefore,
  HttpCode,
  QueryParam,
  BadRequestError
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { AppDataSource } from "../../data-source";
import { Plan } from "../../entity/Plan";
import { MemberSubscription } from "../../entity/MemberSubscription";
import { Payment } from "../../entity/Payment";
import { Member } from "../../entity/Member";
import { UserToken } from "../../entity/UserToken";
import { SubscriptionFeatureUsage } from "../../entity/SubscriptionFeatureUsage";
import { SubscriptionService } from "../../services/subscription.service";
import { RazorpayUpgradeService, RazorpayVerificationService } from "../../services/razorpay.service";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { StartTrialDto, UpgradeSubscriptionDto, BuySubscriptionDto, DowngradeSubscriptionDto, VerifyRazorpayPaymentDto } from "../../dto/mobile/Subscription.dto";
import handleErrorResponse from "../../utils/commonFunction";
import pagination from "../../utils/pagination";
import { ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import { insertPushNotification } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";

@JsonController("/subscription")
export class MobileSubscriptionController {
  private subscriptionService = new SubscriptionService();
  private razorpayUpgradeService = new RazorpayUpgradeService();
  private razorpayVerificationService = new RazorpayVerificationService();
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private subRepo = AppDataSource.getMongoRepository(MemberSubscription);
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private usageRepo = AppDataSource.getMongoRepository(SubscriptionFeatureUsage);

  /**
   * @swagger
   * /mobile-api/subscription/plans:
   *   get:
   *     summary: Get all active subscription plans (Mobile)
   *     tags: [Mobile Subscription]
   *     responses:
   *       200:
   *         description: Plans retrieved successfully
   */
  @Get("/plans")
  async getPlans(@Req() req: any, @Res() res: any) {
    try {
      const plans = await this.planRepo.find({
        where: { status: "active", isDeleted: false }
      });

      // Optional Auth and subscription check
      let memberId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        if (token) {
          try {
            let decoded: any;
            try {
              decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
            } catch (error: any) {
              if (error.name === "TokenExpiredError") {
                decoded = jwt.verify(token, process.env.JWT_SECRET as string, { ignoreExpiration: true }) as any;
              } else {
                throw error;
              }
            }

            const decodedId = decoded.userId || decoded.id;
            if (decodedId) {
              // Verify active member status in DB
              const member = await this.memberRepo.findOneBy({
                _id: new ObjectId(decodedId),
                isDeleted: false
              });

              if (member && member.status === "active") {
                // Verify session record in DB
                const tokenRepo = AppDataSource.getMongoRepository(UserToken);
                let activeTokenRecord = await tokenRepo.findOneBy({
                  userId: new ObjectId(decodedId),
                  token: token
                });

                if (!activeTokenRecord) {
                  // Fallback concurrent request validation
                  const dbRecord = await tokenRepo.findOneBy({ userId: new ObjectId(decodedId) });
                  if (dbRecord) {
                    try {
                      const decodedDb: any = jwt.decode(dbRecord.token);
                      const decodedClient: any = jwt.decode(token);
                      if (decodedDb && decodedClient && (decodedClient.iat || 0) <= (decodedDb.iat || 0)) {
                        activeTokenRecord = dbRecord;
                      }
                    } catch {
                      // ignore
                    }
                  }
                }

                if (activeTokenRecord) {
                  memberId = decodedId;
                }
              }
            }
          } catch (err) {
            console.log("Token verification error:", err);
            // Ignore token error for optional auth
          }
        }
      }

      let hasUsedTrial = false;
      let currentPlanId: string | null = null;
      let currentPlanAmount = 0;
      let isCurrentSubTrial = false;

      if (memberId) {
        const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId), isDeleted: false });
        if (member) {
          hasUsedTrial = member.hasUsedTrial;
          const activeSub = await this.subscriptionService.getActiveSubscription(member._id);
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

      // Map plans to include action and isTrial fields
      const mappedPlans = plans.map(p => {
        let action: string | null = "Get Trial";
        let isTrial = false;

        if (memberId) {
          if (!hasUsedTrial) {
            isTrial = false;
            action = (p.trialDays && p.trialDays > 0) ? "Get Trial" : "Upgrade";
          } else {
            if (currentPlanId === p._id.toString()) {
              if (isCurrentSubTrial) {
                isTrial = true;
                action = "Buy";
              } else {
                isTrial = false;
                action = "Current";
              }
            } else {
              isTrial = false;
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
          isTrial,
          action
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: mappedPlans
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/start-trial:
   *   post:
   *     summary: Opt-in / start a Free Trial for a paid plan (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/StartTrialDto'
   *     responses:
   *       201:
   *         description: Trial started successfully
   */
  @Post("/start-trial")
  @UseBefore(MobileAuthMiddleware)
  @HttpCode(StatusCodes.CREATED)
  async startTrial(@Req() req: any, @Body() body: StartTrialDto, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const sub = await this.subscriptionService.startTrial(memberId, body.planId);
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
      if (!member) {
        throw new BadRequestError("Member not found");
      }
      await insertPushNotification({
        token: member.fcmToken || "",
        subject: "Welcome to Your Free Trial! 🎉",
        content: "Your free trial has started. Enjoy full access to the available features during your trial period.",
        moduleName: NotificationModule.TRIAL,
        moduleId: body.planId,
        receiverId: member._id.toString()
      });
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Free Trial activated successfully!",
        data: sub
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/current:
   *   get:
   *     summary: Get details of the currently active subscription (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Current subscription details
   */
  @Get("/current")
  @UseBefore(MobileAuthMiddleware)
  async getCurrentSubscription(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const subDetails = await this.subscriptionService.getActiveSubscription(memberId);
      return res.status(StatusCodes.OK).json({
        success: true,
        data: subDetails
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/buy:
   *   post:
   *     summary: Create subscription checkout for full purchase / initiate payment via Razorpay (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BuySubscriptionDto'
   *     responses:
   *       200:
   *         description: Subscription checkout transaction created
   */
  @Post("/buy")
  @UseBefore(MobileAuthMiddleware)
  async buySubscription(@Req() req: any, @Body() body: BuySubscriptionDto, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const { planId } = body;

      const paymentData = await this.razorpayUpgradeService.initiateBuy(
        memberId,
        planId
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Razorpay payment transaction initiated.",
        data: paymentData
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/upgrade-breakdown:
   *   get:
   *     summary: Fetch breakdown details for a plan upgrade (proration calculation preview)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *         description: The ID of the subscription plan to upgrade to
   *     responses:
   *       200:
   *         description: Plan upgrade breakdown calculated successfully
   */
  @Get("/upgrade-breakdown")
  @UseBefore(MobileAuthMiddleware)
  async getUpgradeBreakdown(
    @QueryParam("planId") planId: string,
    @Req() req: any,
    @Res() res: any
  ) {
    try {
      if (!planId) {
        throw new BadRequestError("Plan ID is required");
      }
      const memberId = req.user.userId;
      const breakdown = await this.razorpayUpgradeService.getUpgradeBreakdown(
        memberId,
        planId
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        data: breakdown
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/downgrade-breakdown:
   *   get:
   *     summary: Fetch breakdown details for a plan downgrade (proration calculation preview)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *         description: The ID of the subscription plan to downgrade to
   *     responses:
   *       200:
   *         description: Plan downgrade breakdown calculated successfully
   */
  @Get("/downgrade-breakdown")
  @UseBefore(MobileAuthMiddleware)
  async getDowngradeBreakdown(
    @QueryParam("planId") planId: string,
    @Req() req: any,
    @Res() res: any
  ) {
    try {
      if (!planId) {
        throw new BadRequestError("Plan ID is required");
      }
      const memberId = req.user.userId;
      const breakdown = await this.razorpayUpgradeService.getDowngradeBreakdown(
        memberId,
        planId
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        data: breakdown
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/downgrade:
   *   post:
   *     summary: Immediately downgrade a plan and calculate prorated credit extension (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DowngradeSubscriptionDto'
   *     responses:
   *       200:
   *         description: Downgrade completed successfully
   */
  @Post("/downgrade")
  @UseBefore(MobileAuthMiddleware)
  async downgradeSubscription(
    @Req() req: any,
    @Body() body: DowngradeSubscriptionDto,
    @Res() res: any
  ) {
    try {
      const memberId = req.user.userId;
      const { planId } = body;

      const result = await this.razorpayUpgradeService.executeDowngrade(
        memberId,
        planId
      );
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
      if (!member) {
        throw new BadRequestError("Member not found");
      }
      await insertPushNotification({
        token: member.fcmToken || "",
        subject: "Plan Downgraded",
        content: "Your subscription plan has been downgraded successfully. Your new plan is now active.",
        moduleName: NotificationModule.DOWNGRADE,
        moduleId: planId.toString(),
        receiverId: member._id.toString()
      });
      return res.status(StatusCodes.OK).json(result);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/upgrade:
   *   post:
   *     summary: Create subscription checkout / initiate payment via Razorpay (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpgradeSubscriptionDto'
   *     responses:
   *       200:
   *         description: Subscription checkout transaction created
   */
  @Post("/upgrade")
  @UseBefore(MobileAuthMiddleware)
  async upgradeSubscription(@Req() req: any, @Body() body: UpgradeSubscriptionDto, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const { planId } = body;

      const paymentData = await this.razorpayUpgradeService.initiateUpgrade(
        memberId,
        planId
      );
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
      if (!member) {
        throw new BadRequestError("Member not found");
      }
      await insertPushNotification({
        token: member.fcmToken || "",
        subject: "Plan Upgraded Successfully",
        content: "Congratulations! Your subscription plan has been upgraded successfully.",
        moduleName: NotificationModule.UPGRADE,
        moduleId: planId.toString(),
        receiverId: member._id.toString()
      });
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Razorpay payment transaction initiated.",
        data: paymentData
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/verify-payment:
   *   post:
   *     summary: Verify Razorpay payment signature and activate subscription (Mobile)
   *     tags: [Mobile Subscription]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/VerifyRazorpayPaymentDto'
   *     responses:
   *       200:
   *         description: Razorpay signature verification and activation results
   */
  @Post("/verify-payment")
  async verifyPayment(@Body() body: VerifyRazorpayPaymentDto, @Res() res: any) {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
      const result = await this.razorpayVerificationService.verifyUpgradePayment(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );
      return res.status(StatusCodes.OK).json(result);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/cancel:
   *   post:
   *     summary: Cancel current paid subscription and downgrade to Free (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Cancelled successfully
   */
  @Post("/cancel")
  @UseBefore(MobileAuthMiddleware)
  async cancelSubscription(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const result = await this.subscriptionService.cancelSubscription(memberId);
      return res.status(StatusCodes.OK).json({
        success: true,
        ...result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/history:
   *   get:
   *     summary: Get complete subscription history for member (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Subscription records history list
   */
  @Get("/history")
  @UseBefore(MobileAuthMiddleware)
  async getSubscriptionHistory(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const history = await this.subRepo.find({
        where: { memberId: new ObjectId(memberId), isDeleted: false },
        order: { startDate: "DESC" }
      });

      // Populate plan titles
      const plans = await this.planRepo.find({ where: { isDeleted: false } });
      const planMap = new Map(plans.map(p => [p._id.toString(), p.title]));

      const data = history.map(h => ({
        ...h,
        planTitle: planMap.get(h.planId.toString()) || "Unknown Plan"
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/features:
   *   get:
   *     summary: Get current features usage logs and limits (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Features limits and usages
   */
  @Get("/features")
  @UseBefore(MobileAuthMiddleware)
  async getFeaturesUsage(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;
      const activeSub = await this.subscriptionService.getActiveSubscription(memberId);

      let usages: any[] = [];
      if (activeSub.subscriptionId) {
        usages = await this.usageRepo.find({
          where: {
            memberId: new ObjectId(memberId),
            subscriptionId: new ObjectId(activeSub.subscriptionId)
          }
        });
      }

      const currentUsageMap = new Map(usages.map(u => [u.featureType, u.count]));

      const data = {
        planName: activeSub.planName,
        type: activeSub.type,
        features: Object.entries(activeSub.features).map(([key, limit]) => {
          let currentCount = 0;
          if (key === "maxConnections") {
            currentCount = currentUsageMap.get("connections_created") || 0;
          } else if (key === "maxMessages") {
            currentCount = currentUsageMap.get("messages_sent") || 0;
          }

          const val = limit as any;
          return {
            feature: key,
            limit: val,
            currentUsage: currentCount,
            hasAccess: val === -1 || val === true || (typeof val === "number" && currentCount < val) || typeof val === "string"
          };
        })
      };

      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/analytics:
   *   get:
   *     summary: Get platform subscription analytics (Admin/Dashboard overview)
   *     tags: [Mobile Subscription]
   *     responses:
   *       200:
   *         description: Platform subscription metrics
   */
  @Get("/analytics")
  async getAnalytics(@Res() res: any) {
    try {
      const trialUsers = await this.subRepo.count({ type: "TRIAL", status: "ACTIVE", isDeleted: false });
      const premiumUsers = await this.subRepo.count({ type: "PREMIUM", status: "ACTIVE", isDeleted: false });
      const activeSubscribers = await this.subRepo.count({ status: "ACTIVE", isDeleted: false });
      const expiredSubscribers = await this.subRepo.count({ status: "EXPIRED", isDeleted: false });

      // Revenue
      const payments = await this.paymentRepo.find({ where: { status: "COMPLETED", isDeleted: false } });
      const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);

      // Trial Conversion
      const trialUsedCount = await this.memberRepo.count({ hasUsedTrial: true, isDeleted: false });

      let convertedCount = 0;
      if (trialUsedCount > 0) {
        const upgradedSubs = await this.subRepo.find({
          where: {
            type: { $in: ["PREMIUM", "BUSINESS"] },
            isDeleted: false
          } as any
        });
        const upgradedMemberIds = new Set(upgradedSubs.map(s => s.memberId.toString()));
        for (const mId of upgradedMemberIds) {
          const member = await this.memberRepo.findOneBy({ _id: new ObjectId(mId), hasUsedTrial: true, isDeleted: false });
          if (member) convertedCount++;
        }
      }
      const trialConversionRate = trialUsedCount > 0 ? Number(((convertedCount / trialUsedCount) * 100).toFixed(2)) : 0;

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          trialUsers,
          premiumUsers,
          activeSubscribers,
          expiredSubscribers,
          totalRevenue,
          trialUsedCount,
          convertedCount,
          trialConversionRate: `${trialConversionRate}%`
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/subscription/payment-history:
   *   get:
   *     summary: Get payment history with subscription details and plan name for logged-in member (Mobile)
   *     tags: [Mobile Subscription]
   *     security:
   *       - bearerAuth: []
    *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Payment records list with plan and subscription details
   */
  @Get("/payment-history")
  @UseBefore(MobileAuthMiddleware)
  async getPaymentHistory(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      const memberId = req.user.userId;
      const pageNum = Number(page) || 0;
      const limitNum = Number(limit) || 10;

      const [payments, total] = await this.paymentRepo.findAndCount({
        where: {
          memberId: new ObjectId(memberId),
          isDeleted: false
        },
        order: { createdAt: "DESC" },
        skip: pageNum * limitNum,
        take: limitNum
      });

      if (payments.length === 0) {
        return pagination(total, [], limitNum, pageNum, res);
      }

      // Fetch all plans and subscriptions to build maps
      const planIds = [...new Set(payments.map(p => p.planId).filter(id => id))];
      const previousPlanIds = [...new Set(payments.map(p => p.previousPlanId).filter((id): id is ObjectId => !!id))];

      const allPlanIds = [...new Set([...planIds, ...previousPlanIds])];

      const plans = allPlanIds.length > 0
        ? await this.planRepo.find({ where: { _id: { $in: allPlanIds } } as any })
        : [];
      const planMap = new Map(plans.map(p => [p._id.toString(), p]));

      // Query all member subscriptions to find historical matches for date details
      const subscriptions = await this.subRepo.find({
        where: {
          memberId: new ObjectId(memberId),
          isDeleted: false
        }
      });
      const subMap = new Map(subscriptions.map(s => [s._id.toString(), s]));

      const getSubForPlan = (planId: ObjectId | undefined, paymentCreatedAt: Date, excludeSubId?: ObjectId) => {
        if (!planId) return null;
        const planIdStr = planId.toString();
        const candidateSubs = subscriptions.filter(s =>
          s.planId &&
          s.planId.toString() === planIdStr &&
          (!excludeSubId || s._id.toString() !== excludeSubId.toString())
        );
        if (candidateSubs.length === 0) return null;

        // Find the one closest to paymentCreatedAt
        candidateSubs.sort((a, b) => {
          const diffA = Math.abs(a.startDate.getTime() - paymentCreatedAt.getTime());
          const diffB = Math.abs(b.startDate.getTime() - paymentCreatedAt.getTime());
          return diffA - diffB;
        });
        return candidateSubs[0];
      };

      const data = payments.map(p => {
        const plan = p.planId ? planMap.get(p.planId.toString()) : null;
        const previousPlan = p.previousPlanId ? planMap.get(p.previousPlanId.toString()) : null;
        const sub = p.subscriptionId ? subMap.get(p.subscriptionId.toString()) : null;

        // Find matching subscriptions for plan and previousPlan to extract dates
        const newSub = sub || getSubForPlan(p.planId, p.createdAt);
        const oldSub = getSubForPlan(p.previousPlanId, p.createdAt, p.subscriptionId);

        return {
          ...p,
          planName: plan ? plan.title : "Unknown Plan",
          action: p.action || "payment",
          oldPlanDetails: previousPlan ? {
            _id: previousPlan._id,
            title: previousPlan.title,
            amount: previousPlan.amount,
            billingType: previousPlan.billingType,
            billingCycle: previousPlan.billingCycle,
            startDate: oldSub ? oldSub.startDate : null,
            endDate: oldSub ? oldSub.endDate : null
          } : null,
          updatedPlanDetails: plan ? {
            _id: plan._id,
            title: plan.title,
            amount: plan.amount,
            billingType: plan.billingType,
            billingCycle: plan.billingCycle,
            startDate: newSub ? newSub.startDate : null,
            endDate: newSub ? newSub.endDate : null
          } : null,
          currentSubscriptionDetails: sub ? {
            _id: sub._id,
            type: sub.type,
            status: sub.status,
            startDate: sub.startDate,
            endDate: sub.endDate,
            isTrial: sub.isTrial
          } : null
        };
      });

      return pagination(total, data, limitNum, pageNum, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
