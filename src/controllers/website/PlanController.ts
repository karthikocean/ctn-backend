import {
  JsonController,
  Get,
  Param,
  QueryParam,
  Res,
  NotFoundError,
  BadRequestError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Plan } from "../../entity/Plan";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";

/**
 * @swagger
 * tags:
 *   name: Website Plans
 *   description: Public website subscription plan APIs
 */

@JsonController("/plans")
export class WebsitePlanController {
  private planRepo = AppDataSource.getMongoRepository(Plan);

  /**
   * @swagger
   * /website-api/plans:
   *   get:
   *     summary: Get all active subscription plans for website display
   *     tags: [Website Plans]
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Optional search query for plan title
   *       - in: query
   *         name: billingCycle
   *         schema:
   *           type: string
   *           enum: [monthly, yearly, none]
   *         description: Optional filter by billing cycle
   *     responses:
   *       200:
   *         description: List of active subscription plans retrieved successfully
   */
  @Get("/")
  async getWebsitePlans(
    @QueryParam("search") search: string,
    @QueryParam("billingCycle") billingCycle: string,
    @Res() res: any
  ) {
    try {
      const where: any = {
        isDeleted: false,
        status: "active"
      };

      if (billingCycle && billingCycle.trim() !== "") {
        where.billingCycle = billingCycle.trim();
      }

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { title: regex },
          { description: regex }
        ];
      }

      const plans = await this.planRepo.find({
        where,
        order: { sort: "ASC", createdAt: "ASC" }
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Active subscription plans retrieved successfully",
        total: plans.length,
        data: plans
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/plans/{id}:
   *   get:
   *     summary: Get single active subscription plan details by ID
   *     tags: [Website Plans]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Plan ObjectId
   *     responses:
   *       200:
   *         description: Plan details retrieved successfully
   *       404:
   *         description: Plan not found
   */
  @Get("/:id")
  async getPlanById(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Plan ID");
      }

      const plan = await this.planRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false,
        status: "active"
      });

      if (!plan) {
        throw new NotFoundError("Subscription plan not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Subscription plan retrieved successfully",
        data: plan
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
