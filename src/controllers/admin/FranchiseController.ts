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
  UseBefore,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Franchise, FranchiseStatus } from "../../entity/Franchise";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { resolveRegions, resolveRegion } from "../../utils/region.helper";
import { AdminUser } from "../../entity/AdminUser";
import { CreateFranchiseDto, UpdateFranchiseDto } from "../../dto/admin/Franchise.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { Member } from "../../entity/Member";
import { Payment } from "../../entity/Payment";
import { FranchisePaymentHistory } from "../../entity/FranchisePaymentHistory";
import { Plan } from "../../entity/Plan";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";

@JsonController("/franchises")
@UseBefore(AuthMiddleware, franchiseFilter)
export class FranchiseController {
  private franchiseRepo = AppDataSource.getMongoRepository(Franchise);
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private adminUserRepo = AppDataSource.getMongoRepository(AdminUser);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private paymentRepo = AppDataSource.getMongoRepository(Payment);
  private paymentHistoryRepo = AppDataSource.getMongoRepository(FranchisePaymentHistory);
  private planRepo = AppDataSource.getMongoRepository(Plan);

  /**
   * @swagger
   * /api/admin/franchises:
   *   post:
   *     summary: Create a new franchise
   *     tags: [Franchise]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               businessRegionId:
   *                 type: string
   *               userId:
   *                 type: array
   *                 items:
   *                   type: string
   *               status:
   *                 type: string
   *                 enum: [active, inactive]
   *     responses:
   *       201:
   *         description: Franchise created successfully
   */
  @Post("/")
  @UseBefore(canAccess("franchises", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateFranchiseDto, @Res() res: any) {
    try {
      // Validate business region
      if (!ObjectId.isValid(data.businessRegionId)) {
        throw new BadRequestError("Invalid businessRegionId");
      }
      const region = await this.regionRepo.findOne({
        where: {
          $or: [
            { _id: new ObjectId(data.businessRegionId) },
            { "areas._id": new ObjectId(data.businessRegionId) }
          ],
          isDeleted: false
        } as any
      });
      if (!region) {
        throw new NotFoundError("Business region not found");
      }

      // Check if duplicate franchise name exists
      const existing = await this.franchiseRepo.findOne({
        where: {
          name: { $regex: `^${data.name.trim()}$`, $options: "i" },
          isDeleted: false
        }
      });
      if (existing) {
        throw new BadRequestError("Franchise with this name already exists");
      }

      // Check if duplicate businessRegionId exists
      const regionExisting = await this.franchiseRepo.findOne({
        where: {
          businessRegionId: new ObjectId(data.businessRegionId),
          isDeleted: false
        }
      });
      if (regionExisting) {
        throw new BadRequestError("A franchise already exists for this business region");
      }

      // Validate userIds if provided
      let userObjectIds: ObjectId[] = [];
      if (data.userId && data.userId.length > 0) {
        for (const uid of data.userId) {
          if (!ObjectId.isValid(uid)) {
            throw new BadRequestError(`Invalid userId: ${uid}`);
          }
          userObjectIds.push(new ObjectId(uid));
        }

        // Verify users exist
        const usersCount = await this.adminUserRepo.count({
          _id: { $in: userObjectIds },
          isDeleted: false
        } as any);
        if (usersCount !== userObjectIds.length) {
          throw new BadRequestError("One or more userIds are invalid or do not exist");
        }
      }

      const franchise = new Franchise();
      franchise.name = data.name.trim();
      franchise.businessRegionId = new ObjectId(data.businessRegionId);
      franchise.userId = userObjectIds;
      franchise.status = data.status || FranchiseStatus.ACTIVE;
      franchise.commissionPercentage = data.commissionPercentage !== undefined ? data.commissionPercentage : 0;
      franchise.isDeleted = false;

      const saved = await this.franchiseRepo.save(franchise);

      return res.status(StatusCodes.CREATED).json({
        message: "Franchise created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises:
   *   get:
   *     summary: Get all franchises with pagination, search, and filters
   *     tags: [Franchise]
   */
  @Get("/")
  @UseBefore(canAccess("franchises", "view"))
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: string,
    @QueryParam("businessRegionId") businessRegionId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (req.isFranchise) {
        if (req.franchise) {
          where._id = req.franchise._id;
        } else {
          where._id = new ObjectId();
        }
      }

      if (search) {
        const matchingUsers = await this.adminUserRepo.find({
          where: {
            name: { $regex: search, $options: "i" },
            isDeleted: false
          }
        });
        const matchingUserIds = matchingUsers.map(u => u.id);

        where.$or = [
          { name: { $regex: search, $options: "i" } },
          { userId: { $in: matchingUserIds } }
        ];
      }

      if (status) {
        where.status = status;
      }

      if (businessRegionId) {
        if (!ObjectId.isValid(businessRegionId)) {
          throw new BadRequestError("Invalid businessRegionId");
        }
        where.businessRegionId = new ObjectId(businessRegionId);
      }

      const [franchises, total] = await this.franchiseRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Populate Business Regions
      const regionIds = franchises
        .map(f => f.businessRegionId)
        .filter((id): id is ObjectId => !!id);

      const regions = regionIds.length > 0
        ? await this.regionRepo.find({
          where: {
            $or: [
              { _id: { $in: regionIds } },
              { "areas._id": { $in: regionIds } }
            ]
          } as any
        })
        : [];
      const resolvedRegions = await resolveRegions(regions);

      // Populate AdminUsers (Users)
      const userIds = franchises
        .flatMap(f => f.userId || [])
        .filter((id): id is ObjectId => !!id);

      const adminUsers = userIds.length > 0
        ? await this.adminUserRepo.find({ where: { _id: { $in: userIds } } as any })
        : [];

      const userMap = new Map(
        adminUsers.map(u => [u.id.toString(), { _id: u.id, fullName: u.name, email: u.email, mobileNumber: u.phoneNumber }])
      );

      const populated = franchises.map(f => {
        let businessRegion = null;
        if (f.businessRegionId) {
          const region = resolvedRegions.find(r =>
            r._id.toString() === f.businessRegionId.toString() ||
            (r.areas && r.areas.some((a: any) => a._id.toString() === f.businessRegionId.toString()))
          );
          if (region) {
            const matchedArea = region.areas?.find((a: any) => a._id.toString() === f.businessRegionId.toString());
            businessRegion = {
              _id: f.businessRegionId,
              name: matchedArea ? matchedArea.name : `${region.city}, ${region.state}`,
              city: region.city,
              state: region.state,
              country: region.country,
              areas: region.areas
            };
          }
        }
        return {
          ...f,
          businessRegion,
          users: (f.userId || []).map(uid => userMap.get(uid.toString())).filter(Boolean)
        };
      });

      return pagination(total, populated, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/commission-report")
  @UseBefore(canAccess("franchises", "view"))
  async getCommissionReport(
    @Req() req: any,
    @QueryParam("month") month: string,
    @QueryParam("search") search: string,
    @QueryParam("page") page: any,
    @QueryParam("limit") limit: any,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      if (!month) {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        month = `${d.getFullYear()}-${mm}`;
      }

      const [yearStr, monthStr] = month.split("-");
      const year = Number(yearStr);
      const mNum = Number(monthStr);
      const startDate = new Date(year, mNum - 1, 1);
      const endDate = new Date(year, mNum, 1);

      const where: any = { isDeleted: false };
      if (req.isFranchise) {
        if (req.franchise) {
          where._id = req.franchise._id;
        } else {
          where._id = new ObjectId();
        }
      }
      if (search) {
        const matchingUsers = await this.adminUserRepo.find({
          where: {
            name: { $regex: search, $options: "i" },
            isDeleted: false
          }
        });
        const matchingUserIds = matchingUsers.map(u => u.id);

        where.$or = [
          { name: { $regex: search, $options: "i" } },
          { userId: { $in: matchingUserIds } }
        ];
      }

      const [franchises, total] = await this.franchiseRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      const regionIds = franchises
        .map(f => f.businessRegionId)
        .filter((id): id is ObjectId => !!id);

      const allMembers = regionIds.length > 0
        ? await this.memberRepo.find({
          where: {
            businessRegion: { $in: regionIds },
            isDeleted: false
          } as any
        })
        : [];

      const memberIds = allMembers.map(m => m._id);
      const allPayments = (memberIds.length > 0)
        ? await this.paymentRepo.find({
          where: {
            memberId: { $in: memberIds },
            status: "COMPLETED",
            createdAt: { $gte: startDate, $lt: endDate }
          } as any
        })
        : [];

      const historyRecords = await this.paymentHistoryRepo.find({
        where: {
          franchiseId: { $in: franchises.map(f => f._id) },
          month,
          isDeleted: false
        } as any
      });
      const historyMap = new Map(historyRecords.map(h => [h.franchiseId.toString(), h]));

      const allUserIds = franchises
        .flatMap(f => f.userId || [])
        .filter((id): id is ObjectId => !!id);

      const adminUsers = allUserIds.length > 0
        ? await this.adminUserRepo.find({ where: { _id: { $in: allUserIds } } as any })
        : [];
      const userMap = new Map(adminUsers.map(u => [u.id.toString(), u.name]));

      const reportData = franchises.map((f) => {
        const fMembers = allMembers.filter(m => m.businessRegion?.toString() === f.businessRegionId?.toString());

        // Only new members who joined this month
        const newMembersThisMonth = fMembers.filter(m => m.createdAt >= startDate && m.createdAt < endDate);
        const newMemberIdSet = new Set(newMembersThisMonth.map(m => m._id.toString()));

        // Payments only from new members (excludes existing member renewals)
        const newMemberPayments = allPayments.filter(p => newMemberIdSet.has(p.memberId.toString()));
        const payingNewMemberIds = new Set(newMemberPayments.map(p => p.memberId.toString()));

        // Count only new members who actually paid (excludes trial/no-payment users)
        const memberJoinedCount = newMembersThisMonth.filter(m => payingNewMemberIds.has(m._id.toString())).length;

        // Total amount = only from new member payments
        const totalAmount = newMemberPayments.reduce((sum, p) => sum + p.amount, 0);

        const commissionPercent = f.commissionPercentage || 0;
        const commissionAmount = totalAmount * commissionPercent / 100;

        const history = historyMap.get(f._id.toString());
        const status = history ? history.status : "pending";
        const paymentReceiptUrl = history ? history.paymentReceiptUrl : null;
        const historyId = history ? history._id : null;

        const ownerNames = (f.userId || [])
          .map(uid => userMap.get(uid.toString()))
          .filter(Boolean)
          .join(", ") || "No Owner";

        return {
          franchiseId: f._id,
          franchiseName: f.name,
          franchiseOwner: ownerNames,
          memberJoinedCount,
          month,
          totalAmount,
          commissionPercent,
          commissionAmount,
          status,
          paymentReceiptUrl,
          historyId
        };
      });

      return pagination(total, reportData, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Post("/commission-report/settle")
  @UseBefore(canAccess("franchises", "edit"))
  async settleCommission(
    @Req() req: any,
    @Body() body: { franchiseId: string; month: string; status: string; paymentReceiptUrl?: string },
    @Res() res: any
  ) {
    try {
      const { franchiseId, month, status, paymentReceiptUrl } = body;

      if (req.isFranchise) {
        if (!req.franchise || req.franchise._id.toString() !== franchiseId) {
          throw new BadRequestError("Access Denied: You cannot modify other franchises' settlements");
        }
      }

      if (!franchiseId || !ObjectId.isValid(franchiseId)) {
        throw new BadRequestError("Invalid or missing franchiseId");
      }
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        throw new BadRequestError("Invalid or missing month (YYYY-MM)");
      }
      if (status !== "settled" && status !== "pending") {
        throw new BadRequestError("Status must be 'settled' or 'pending'");
      }

      const franchise = await this.franchiseRepo.findOneBy({ _id: new ObjectId(franchiseId), isDeleted: false });
      if (!franchise) {
        throw new NotFoundError("Franchise not found");
      }

      let record = await this.paymentHistoryRepo.findOne({
        where: { franchiseId: new ObjectId(franchiseId), month, isDeleted: false }
      });

      if (record) {
        record.status = status;
        if (paymentReceiptUrl !== undefined) {
          record.paymentReceiptUrl = paymentReceiptUrl;
        }
        record.settledAt = status === "settled" ? new Date() : undefined;
      } else {
        record = this.paymentHistoryRepo.create({
          franchiseId: new ObjectId(franchiseId),
          month,
          status,
          paymentReceiptUrl,
          settledAt: status === "settled" ? new Date() : undefined,
          isDeleted: false
        });
      }

      const saved = await this.paymentHistoryRepo.save(record);

      return res.status(StatusCodes.OK).json({
        message: "Franchise settlement updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/commission-report/details")
  @UseBefore(canAccess("franchises", "view"))
  async getCommissionReportDetails(
    @Req() req: any,
    @QueryParam("franchiseId") franchiseId: string,
    @QueryParam("month") month: string,
    @Res() res: any
  ) {
    try {
      if (req.isFranchise) {
        if (!req.franchise || req.franchise._id.toString() !== franchiseId) {
          throw new BadRequestError("Access Denied: You can only view details of your own franchise");
        }
      }

      if (!franchiseId || !ObjectId.isValid(franchiseId)) {
        throw new BadRequestError("Invalid or missing franchiseId");
      }
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        throw new BadRequestError("Invalid or missing month (YYYY-MM)");
      }

      const [yearStr, monthStr] = month.split("-");
      const year = Number(yearStr);
      const mNum = Number(monthStr);
      const startDate = new Date(year, mNum - 1, 1);
      const endDate = new Date(year, mNum, 1);

      const franchise = await this.franchiseRepo.findOneBy({ _id: new ObjectId(franchiseId), isDeleted: false });
      if (!franchise) {
        throw new NotFoundError("Franchise not found");
      }

      // Populate Business Region name
      let businessRegionName = "No Region";
      if (franchise.businessRegionId) {
        const region = await this.regionRepo.findOne({
          where: {
            $or: [
              { _id: franchise.businessRegionId },
              { "areas._id": franchise.businessRegionId }
            ],
            isDeleted: false
          } as any
        });
        if (region) {
          const resolved = await resolveRegion(region);
          const matchedArea = resolved.areas?.find((a: any) => a._id.toString() === franchise.businessRegionId.toString());
          businessRegionName = matchedArea ? matchedArea.name : `${resolved.city}, ${resolved.state}`;
        }
      }

      // Populate Owners names
      const allUserIds = (franchise.userId || []).filter((id): id is ObjectId => !!id);
      const adminUsers = allUserIds.length > 0
        ? await this.adminUserRepo.find({ where: { _id: { $in: allUserIds } } as any })
        : [];
      const ownerNames = adminUsers.map(u => u.name).join(", ") || "No Owner";

      // Members of this franchise's business region
      const regionId = franchise.businessRegionId;
      const allMembers = regionId
        ? await this.memberRepo.find({
          where: {
            businessRegion: regionId,
            isDeleted: false
          } as any
        })
        : [];

      // Members who joined in this month only
      const membersJoinedThisMonth = allMembers.filter(m => m.createdAt >= startDate && m.createdAt < endDate);
      const newMemberIds = membersJoinedThisMonth.map(m => m._id);

      // Payments ONLY from members who joined this month (excludes existing member renewals)
      const payments = (newMemberIds.length > 0)
        ? await this.paymentRepo.find({
          where: {
            memberId: { $in: newMemberIds },
            status: "COMPLETED",
            createdAt: { $gte: startDate, $lt: endDate }
          } as any
        })
        : [];

      // Fetch plan names for the payments
      const planIds = [...new Set(payments.map(p => p.planId?.toString()).filter(Boolean))];
      const plans = planIds.length > 0
        ? await this.planRepo.find({
          where: { _id: { $in: planIds.map(id => new ObjectId(id)) } } as any
        })
        : [];
      const planMap = new Map(plans.map(pl => [pl._id.toString(), pl]));

      // Build a payment lookup by memberId (last payment wins per member)
      const paymentByMember = new Map<string, Payment>();
      for (const p of payments) {
        paymentByMember.set(p.memberId.toString(), p);
      }
      // Set of member IDs who actually paid (non-trial)
      const payingMemberIds = new Set(payments.map(p => p.memberId.toString()));

      // Build member detail list — show ALL new joiners but mark trial users clearly
      const memberDetails = membersJoinedThisMonth.map(m => {
        const payment = paymentByMember.get(m._id.toString());
        const plan = payment ? planMap.get(payment.planId?.toString()) : undefined;
        return {
          memberId: m._id,
          memberName: m.fullName,
          memberEmail: m.email || null,
          memberPhone: m.mobileNumber || null,
          planName: plan ? plan.title : (payment ? "Unknown Plan" : "Trial / No Payment"),
          planAmount: plan ? plan.amount : (payment ? payment.amount : 0),
          joinedDate: m.createdAt,
          amount: payment ? payment.amount : 0,
          isTrial: !payingMemberIds.has(m._id.toString())
        };
      });

      // Total amount = only from paying new members (excludes trial users & existing members)
      const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      const commissionPercent = franchise.commissionPercentage || 0;
      const commissionAmount = totalAmount * commissionPercent / 100;

      // Settlement history record if any
      const historyRecord = await this.paymentHistoryRepo.findOne({
        where: {
          franchiseId: franchise._id,
          month,
          isDeleted: false
        }
      });

      return res.status(StatusCodes.OK).json({
        data: {
          franchiseId: franchise._id,
          franchiseName: franchise.name,
          franchiseOwner: ownerNames,
          franchiseRegion: businessRegionName,
          commissionPercent,
          commissionAmount,
          totalAmount,
          month,
          status: historyRecord ? historyRecord.status : "pending",
          paymentReceiptUrl: historyRecord ? historyRecord.paymentReceiptUrl : null,
          members: memberDetails
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/:id")
  @UseBefore(canAccess("franchises", "view"))
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      if (req.isFranchise) {
        if (!req.franchise || req.franchise._id.toString() !== id) {
          throw new BadRequestError("Access Denied: You can only view your own franchise");
        }
      }

      const franchise = await this.franchiseRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!franchise) throw new NotFoundError("Franchise not found");

      // Populate Business Region
      let businessRegion = null;
      if (franchise.businessRegionId) {
        const region = await this.regionRepo.findOne({
          where: {
            $or: [
              { _id: franchise.businessRegionId },
              { "areas._id": franchise.businessRegionId }
            ],
            isDeleted: false
          } as any
        });
        if (region) {
          const resolved = await resolveRegion(region);
          const matchedArea = resolved.areas?.find((a: any) => a._id.toString() === franchise.businessRegionId.toString());
          businessRegion = {
            _id: franchise.businessRegionId,
            name: matchedArea ? matchedArea.name : `${resolved.city}, ${resolved.state}`,
            city: resolved.city,
            state: resolved.state,
            country: resolved.country,
            areas: resolved.areas
          };
        }
      }

      // Populate Users
      let users: any[] = [];
      if (franchise.userId && franchise.userId.length > 0) {
        const adminUsers = await this.adminUserRepo.find({
          where: { _id: { $in: franchise.userId } } as any
        });
        users = adminUsers.map(u => ({ _id: u.id, fullName: u.name, email: u.email, mobileNumber: u.phoneNumber }));
      }

      return res.status(StatusCodes.OK).json({
        ...franchise,
        businessRegion,
        users
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises/{id}:
   *   put:
   *     summary: Update a franchise
   *     tags: [Franchise]
   */
  @Put("/:id")
  @UseBefore(canAccess("franchises", "edit"))
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdateFranchiseDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      if (req.isFranchise) {
        if (!req.franchise || req.franchise._id.toString() !== id) {
          throw new BadRequestError("Access Denied: You can only update your own franchise");
        }
      }

      const franchise = await this.franchiseRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!franchise) throw new NotFoundError("Franchise not found");
      if (data.status === "inactive") {
        const memberCount = await this.memberRepo.countBy({ businessRegion: new ObjectId(franchise.businessRegionId), isDeleted: false });
        if (memberCount > 0) {
          throw new BadRequestError("Franchise cannot be deactivated as it has active members");
        }
      }
      if (data.name) {
        const trimmedName = data.name.trim();
        // Check duplicate name excluding current
        const existing = await this.franchiseRepo.findOne({
          where: {
            _id: { $ne: new ObjectId(id) },
            name: { $regex: `^${trimmedName}$`, $options: "i" },
            isDeleted: false
          }
        });
        if (existing) {
          throw new BadRequestError("Franchise with this name already exists");
        }
        franchise.name = trimmedName;
      }

      if (data.businessRegionId) {
        if (!ObjectId.isValid(data.businessRegionId)) {
          throw new BadRequestError("Invalid businessRegionId");
        }
        const region = await this.regionRepo.findOne({
          where: {
            $or: [
              { _id: new ObjectId(data.businessRegionId) },
              { "areas._id": new ObjectId(data.businessRegionId) }
            ],
            isDeleted: false
          } as any
        });
        if (!region) {
          throw new NotFoundError("Business region not found");
        }

        // Check if duplicate businessRegionId exists excluding current
        const regionExisting = await this.franchiseRepo.findOne({
          where: {
            _id: { $ne: new ObjectId(id) },
            businessRegionId: new ObjectId(data.businessRegionId),
            isDeleted: false
          }
        });
        if (regionExisting) {
          throw new BadRequestError("A franchise already exists for this business region");
        }

        franchise.businessRegionId = new ObjectId(data.businessRegionId);
      }

      if (data.userId !== undefined) {
        let userObjectIds: ObjectId[] = [];
        if (data.userId.length > 0) {
          for (const uid of data.userId) {
            if (!ObjectId.isValid(uid)) {
              throw new BadRequestError(`Invalid userId: ${uid}`);
            }
            userObjectIds.push(new ObjectId(uid));
          }          // Verify users exist
          const usersCount = await this.adminUserRepo.count({
            _id: { $in: userObjectIds },
            isDeleted: false
          } as any);

          if (usersCount !== userObjectIds.length) {
            throw new BadRequestError("One or more userIds are invalid or do not exist");
          }
        }
        franchise.userId = userObjectIds;
      }

      if (data.status) {
        franchise.status = data.status;
      }

      if (data.commissionPercentage !== undefined) {
        franchise.commissionPercentage = data.commissionPercentage;
      }

      const saved = await this.franchiseRepo.save(franchise);

      return res.status(StatusCodes.OK).json({
        message: "Franchise updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises/{id}:
   *   delete:
   *     summary: Soft delete a franchise
   *     tags: [Franchise]
   */
  @Delete("/:id")
  @UseBefore(canAccess("franchises", "delete"))
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      if (req.isFranchise) {
        if (!req.franchise || req.franchise._id.toString() !== id) {
          throw new BadRequestError("Access Denied: You can only delete your own franchise");
        }
      }

      const franchise = await this.franchiseRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!franchise) throw new NotFoundError("Franchise not found");

      franchise.isDeleted = true;
      await this.franchiseRepo.save(franchise);

      return res.status(StatusCodes.OK).json({
        message: "Franchise deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
