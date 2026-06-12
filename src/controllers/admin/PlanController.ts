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
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Plan } from "../../entity/Plan";
import { Member } from "../../entity/Member";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreatePlanDto, UpdatePlanDto } from "../../dto/admin/Plan.dto";

@JsonController("/plans")
export class AdminPlanController {
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/admin/plans:
   *   post:
   *     summary: Create a new subscription plan (Admin)
   *     tags: [Admin Plan]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreatePlanDto, @Res() res: any) {
    try {
      // ✅ Check for unique title (case-insensitive and trimmed)
      const trimmedTitle = data.title.trim();
      const existing = await this.planRepo.findOne({
        where: {
          title: { $regex: `^${trimmedTitle}$`, $options: "i" },
          isDeleted: false
        }
      });
      if (existing) throw new BadRequestError("A plan with this title already exists");

      // ✅ Check for unique module names
      if (data.modules) {
        const moduleNames = data.modules.map(m => m.moduleName);
        const uniqueModuleNames = new Set(moduleNames);
        if (moduleNames.length !== uniqueModuleNames.size) {
          throw new BadRequestError("Module names must be unique within a plan");
        }
      }

      const plan = new Plan();
      Object.assign(plan, data);
      plan.isDeleted = false;

      const saved = await this.planRepo.save(plan);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Plan created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/plans:
   *   get:
   *     summary: List all plans (Admin)
   *     tags: [Admin Plan]
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
        where.title = { $regex: search, $options: "i" };
      }

      const [plans, total] = await this.planRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      const plansWithCount = await Promise.all(
        plans.map(async (plan) => {
          const memberCount = await this.memberRepo.count({
            planId: plan._id,
            isDeleted: false
          });
          return {
            ...plan,
            memberCount
          };
        })
      );

      return pagination(total, plansWithCount, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/plans/{id}:
   *   get:
   *     summary: Get single plan details
   *     tags: [Admin Plan]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const plan = await this.planRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!plan) throw new NotFoundError("Plan not found");

      return res.status(StatusCodes.OK).json({
        success: true,
        data: plan
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/plans/{id}:
   *   put:
   *     summary: Update plan
   *     tags: [Admin Plan]
   */
  @Put("/:id")
  async update(@Param("id") id: string, @Body() data: UpdatePlanDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const plan = await this.planRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!plan) throw new NotFoundError("Plan not found");

      // Check if title is being changed and if new title already exists (case-insensitive and trimmed)
      if (data.title && data.title.trim().toLowerCase() !== plan.title.toLowerCase()) {
        const trimmedTitle = data.title.trim();
        const existing = await this.planRepo.findOne({
          where: {
            title: { $regex: `^${trimmedTitle}$`, $options: "i" },
            isDeleted: false,
            _id: { $ne: new ObjectId(id) }
          }
        });
        if (existing) throw new BadRequestError("A plan with this title already exists");
      }

      // ✅ Check for unique module names
      if (data.modules) {
        const moduleNames = data.modules.map(m => m.moduleName);
        const uniqueModuleNames = new Set(moduleNames);
        if (moduleNames.length !== uniqueModuleNames.size) {
          throw new BadRequestError("Module names must be unique within a plan");
        }
      }

      Object.assign(plan, data);
      const saved = await this.planRepo.save(plan);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Plan updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/plans/{id}:
   *   delete:
   *     summary: Soft delete plan
   *     tags: [Admin Plan]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const plan = await this.planRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!plan) throw new NotFoundError("Plan not found");

      plan.isDeleted = true;
      await this.planRepo.save(plan);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Plan deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
