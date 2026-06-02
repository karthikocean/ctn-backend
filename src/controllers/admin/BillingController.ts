import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Billing } from "../../entity/Billing";
import { Member } from "../../entity/Member";
import { Plan } from "../../entity/Plan";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateBillingDto, UpdateBillingDto } from "../../dto/admin/Billing.dto";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";

@JsonController("/billings")
@UseBefore(AuthMiddleware)
export class AdminBillingController {
  private billingRepo = AppDataSource.getMongoRepository(Billing);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private planRepo = AppDataSource.getMongoRepository(Plan);

  /**
   * @swagger
   * /api/admin/billings:
   *   post:
   *     summary: Create a new billing record (Admin)
   *     tags: [Admin Billing]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreateBillingDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(data.memberId)) throw new BadRequestError("Invalid Member ID");
      if (!ObjectId.isValid(data.planId)) throw new BadRequestError("Invalid Plan ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(data.memberId), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      const plan = await this.planRepo.findOneBy({ _id: new ObjectId(data.planId), isDeleted: false });
      if (!plan) throw new NotFoundError("Plan not found");

      const billing = new Billing();
      billing.memberId = new ObjectId(data.memberId);
      billing.planId = new ObjectId(data.planId);
      billing.paymentType = data.paymentType;
      billing.amount = data.amount;
      billing.remarks = data.remarks;
      billing.isDeleted = false;

      if (req.user && req.user.userId) {
        billing.createdBy = new ObjectId(req.user.userId);
        billing.updatedBy = new ObjectId(req.user.userId);
      }

      const saved = await this.billingRepo.save(billing);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Billing record created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/billings:
   *   get:
   *     summary: List all billing records (Admin)
   *     tags: [Admin Billing]
   */
  @Get("/")
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (search) {
        // Query members by name matching the search term
        const matchingMembers = await this.memberRepo.find({
          where: {
            fullName: { $regex: search, $options: "i" },
            isDeleted: false
          } as any
        });
        const matchingMemberIds = matchingMembers.map(m => m._id);

        // Query plans by title matching the search term
        const matchingPlans = await this.planRepo.find({
          where: {
            title: { $regex: search, $options: "i" },
            isDeleted: false
          } as any
        });
        const matchingPlanIds = matchingPlans.map(p => p._id);

        where.$or = [
          { memberId: { $in: matchingMemberIds } },
          { planId: { $in: matchingPlanIds } },
          { paymentType: { $regex: search, $options: "i" } },
          { remarks: { $regex: search, $options: "i" } }
        ];
      }

      const [billings, total] = await this.billingRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Bulk populate member and plan details
      const memberIds = billings.map(b => b.memberId).filter((id): id is ObjectId => !!id);
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];
      const memberMap = new Map(members.map(m => [m._id.toString(), { _id: m._id, fullName: m.fullName, email: m.email }]));

      const planIds = billings.map(b => b.planId).filter((id): id is ObjectId => !!id);
      const plans = planIds.length > 0
        ? await this.planRepo.find({ where: { _id: { $in: planIds } } as any })
        : [];
      const planMap = new Map(plans.map(p => [p._id.toString(), { _id: p._id, title: p.title, amount: p.amount }]));

      const data = billings.map(b => ({
        ...b,
        member: b.memberId ? memberMap.get(b.memberId.toString()) : null,
        plan: b.planId ? planMap.get(b.planId.toString()) : null
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/billings/{id}:
   *   get:
   *     summary: Get single billing record details (Admin)
   *     tags: [Admin Billing]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const billing = await this.billingRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!billing) throw new NotFoundError("Billing record not found");

      const member = billing.memberId ? await this.memberRepo.findOneBy({ _id: billing.memberId }) : null;
      const plan = billing.planId ? await this.planRepo.findOneBy({ _id: billing.planId }) : null;

      const data = {
        ...billing,
        member: member ? { _id: member._id, fullName: member.fullName, email: member.email } : null,
        plan: plan ? { _id: plan._id, title: plan.title, amount: plan.amount } : null
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
   * /api/admin/billings/{id}:
   *   put:
   *     summary: Update billing record (Admin)
   *     tags: [Admin Billing]
   */
  @Put("/:id")
  async update(@Param("id") id: string, @Req() req: any, @Body() data: UpdateBillingDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const billing = await this.billingRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!billing) throw new NotFoundError("Billing record not found");

      if (data.memberId) {
        if (!ObjectId.isValid(data.memberId)) throw new BadRequestError("Invalid Member ID");
        const member = await this.memberRepo.findOneBy({ _id: new ObjectId(data.memberId), isDeleted: false });
        if (!member) throw new NotFoundError("Member not found");
        billing.memberId = new ObjectId(data.memberId);
      }

      if (data.planId) {
        if (!ObjectId.isValid(data.planId)) throw new BadRequestError("Invalid Plan ID");
        const plan = await this.planRepo.findOneBy({ _id: new ObjectId(data.planId), isDeleted: false });
        if (!plan) throw new NotFoundError("Plan not found");
        billing.planId = new ObjectId(data.planId);
      }

      if (data.paymentType !== undefined) billing.paymentType = data.paymentType;
      if (data.amount !== undefined) billing.amount = data.amount;
      if (data.remarks !== undefined) billing.remarks = data.remarks;

      if (req.user && req.user.userId) {
        billing.updatedBy = new ObjectId(req.user.userId);
      }

      const saved = await this.billingRepo.save(billing);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Billing record updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/billings/{id}:
   *   delete:
   *     summary: Soft delete billing record (Admin)
   *     tags: [Admin Billing]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Req() req: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const billing = await this.billingRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!billing) throw new NotFoundError("Billing record not found");

      billing.isDeleted = true;
      if (req.user && req.user.userId) {
        billing.updatedBy = new ObjectId(req.user.userId);
      }

      await this.billingRepo.save(billing);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Billing record deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
