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
import { Payment } from "../../entity/Payment";
import { Member } from "../../entity/Member";
import { Plan } from "../../entity/Plan";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateBillingDto, UpdateBillingDto } from "../../dto/admin/Billing.dto";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";

@JsonController("/billings")
@UseBefore(AuthMiddleware, franchiseFilter)
export class AdminBillingController {
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
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

      const payment = new Payment();
      payment.memberId = new ObjectId(data.memberId);
      payment.planId = new ObjectId(data.planId);
      payment.paymentMethod = data.paymentMethod;
      payment.amount = data.amount;
      payment.remarks = data.remarks;
      payment.transactionId = data.transactionId;
      payment.source = "admin";
      payment.status = "COMPLETED";
      payment.isDeleted = false;

      if (req.user && req.user.userId) {
        payment.createdBy = new ObjectId(req.user.userId);
        payment.updatedBy = new ObjectId(req.user.userId);
      }

      const saved = await this.paymentRepo.save(payment);
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
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      let franchiseMemberIds: ObjectId[] = [];

      if (req.isFranchise) {
        const fMemberWhere: any = { isDeleted: false };
        if (req.franchiseAreaIds && req.franchiseAreaIds.length > 0) {
          fMemberWhere.businessRegion = { $in: req.franchiseAreaIds };
        } else {
          fMemberWhere.businessRegion = new ObjectId();
        }
        const fMembers = await this.memberRepo.find({
          where: fMemberWhere
        });
        franchiseMemberIds = fMembers.map(m => m._id);

        if (franchiseMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }
      }

      if (search) {
        // Query members by name matching the search term
        const matchingMembers = await this.memberRepo.find({
          where: {
            fullName: { $regex: search, $options: "i" },
            isDeleted: false
          } as any
        });
        let matchingMemberIds = matchingMembers.map(m => m._id);

        if (req.isFranchise) {
          const fSet = new Set(franchiseMemberIds.map(id => id.toString()));
          matchingMemberIds = matchingMemberIds.filter(id => fSet.has(id.toString()));
        }

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
          { paymentMethod: { $regex: search, $options: "i" } },
          { transactionId: { $regex: search, $options: "i" } },
          { remarks: { $regex: search, $options: "i" } }
        ];

        if (req.isFranchise) {
          where.memberId = { $in: franchiseMemberIds };
        }
      } else {
        if (req.isFranchise) {
          where.memberId = { $in: franchiseMemberIds };
        }
      }

      const [payments, total] = await this.paymentRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Bulk populate member and plan details
      const memberIds = payments.map(p => p.memberId).filter((id): id is ObjectId => !!id);
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];
      const memberMap = new Map(members.map(m => [m._id.toString(), { _id: m._id, fullName: m.fullName, email: m.email }]));

      const planIds = payments.map(p => p.planId).filter((id): id is ObjectId => !!id);
      const plans = planIds.length > 0
        ? await this.planRepo.find({ where: { _id: { $in: planIds } } as any })
        : [];
      const planMap = new Map(plans.map(p => [p._id.toString(), { _id: p._id, title: p.title, amount: p.amount }]));

      const data = payments.map(p => ({
        ...p,
        paymentType: p.paymentMethod || "", // for backward compatibility
        member: p.memberId ? memberMap.get(p.memberId.toString()) : null,
        plan: p.planId ? planMap.get(p.planId.toString()) : null
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
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const payment = await this.paymentRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!payment) throw new NotFoundError("Billing record not found");

      const member = payment.memberId ? await this.memberRepo.findOneBy({ _id: payment.memberId }) : null;

      if (req.isFranchise) {
        const regionId = member?.businessRegion;
        if (!member || !regionId || !req.franchiseAreaIds.some((areaId: ObjectId) => areaId.toString() === regionId.toString())) {
          throw new NotFoundError("Billing record not found");
        }
      }

      const plan = payment.planId ? await this.planRepo.findOneBy({ _id: payment.planId }) : null;

      const data = {
        ...payment,
        paymentType: payment.paymentMethod || "", // for backward compatibility
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

      const payment = await this.paymentRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!payment) throw new NotFoundError("Billing record not found");

      if (data.memberId) {
        if (!ObjectId.isValid(data.memberId)) throw new BadRequestError("Invalid Member ID");
        const member = await this.memberRepo.findOneBy({ _id: new ObjectId(data.memberId), isDeleted: false });
        if (!member) throw new NotFoundError("Member not found");
        payment.memberId = new ObjectId(data.memberId);
      }

      if (data.planId) {
        if (!ObjectId.isValid(data.planId)) throw new BadRequestError("Invalid Plan ID");
        const plan = await this.planRepo.findOneBy({ _id: new ObjectId(data.planId), isDeleted: false });
        if (!plan) throw new NotFoundError("Plan not found");
        payment.planId = new ObjectId(data.planId);
      }

      if (data.paymentMethod !== undefined) {
        payment.paymentMethod = data.paymentMethod;
      }
      if (data.transactionId !== undefined) {
        payment.transactionId = data.transactionId;
      }
      if (data.amount !== undefined) payment.amount = data.amount;
      if (data.remarks !== undefined) payment.remarks = data.remarks;

      if (req.user && req.user.userId) {
        payment.updatedBy = new ObjectId(req.user.userId);
      }

      const saved = await this.paymentRepo.save(payment);

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

      const payment = await this.paymentRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!payment) throw new NotFoundError("Billing record not found");

      payment.isDeleted = true;
      if (req.user && req.user.userId) {
        payment.updatedBy = new ObjectId(req.user.userId);
      }

      await this.paymentRepo.save(payment);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Billing record deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
