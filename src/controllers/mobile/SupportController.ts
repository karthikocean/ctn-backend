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
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Support, SupportStatus } from "../../entity/Support";
import { CreateSupportDto, UpdateSupportDto } from "../../dto/mobile/Support.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/support")
export class MobileSupportController {
  private supportRepo = AppDataSource.getMongoRepository(Support);

  /**
   * @swagger
   * /mobile-api/support:
   *   post:
   *     summary: Submit a new support request (Mobile - Public, no auth required)
   *     tags: [Mobile Support]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSupportDto'
   *     responses:
   *       201:
   *         description: Support request submitted successfully
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async createSupport(@Body() data: CreateSupportDto, @Res() res: any) {
    try {
      const support = new Support();
      support.name = data.name.trim();
      support.phone = data.phone.trim();
      support.email = data.email ? data.email.trim() : undefined;
      support.companyName = data.companyName ? data.companyName.trim() : undefined;
      support.category = data.category ? data.category.trim() : undefined;
      support.description = data.description ? data.description.trim() : undefined;
      support.status = data.status || SupportStatus.PENDING;
      support.isActive = data.isActive !== undefined ? data.isActive : true;
      support.isDeleted = false;

      const saved = await this.supportRepo.save(support);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Support request created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/support:
   *   get:
   *     summary: List support requests with pagination, search, and status filter (Mobile - Public)
   *     tags: [Mobile Support]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [PENDING, IN_PROGRESS, RESOLVED, CLOSED] }
   *       - in: query
   *         name: isActive
   *         schema: { type: boolean }
   *     responses:
   *       200:
   *         description: List of support requests retrieved successfully
   */
  @Get("/")
  async getAllSupports(
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: SupportStatus,
    @QueryParam("isActive") isActive: boolean,
    @Res() res: any
  ) {
    try {
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(500, Number(limitParam) || 10);

      const where: any = { isDeleted: false };

      if (status) {
        where.status = status;
      }

      if (isActive !== undefined) {
        where.isActive = String(isActive) === "true";
      }

      if (search && search.trim()) {
        const term = search.trim();
        where.$or = [
          { name: { $regex: term, $options: "i" } },
          { phone: { $regex: term, $options: "i" } },
          { email: { $regex: term, $options: "i" } },
          { companyName: { $regex: term, $options: "i" } },
          { category: { $regex: term, $options: "i" } },
          { description: { $regex: term, $options: "i" } }
        ];
      }

      const [supports, total] = await this.supportRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, supports, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/support/{id}:
   *   get:
   *     summary: Get single support request details (Mobile - Public)
   *     tags: [Mobile Support]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Support request details retrieved
   *       404:
   *         description: Support request not found
   */
  @Get("/:id")
  async getSupportById(@Param("id") id: string, @Res() res: any) {
    try {
      if (!id || !ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid support ID format");
      }

      const support = await this.supportRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!support) {
        throw new NotFoundError("Support request not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: support
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/support/{id}:
   *   put:
   *     summary: Update support request (Mobile - Public)
   *     tags: [Mobile Support]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateSupportDto'
   *     responses:
   *       200:
   *         description: Support request updated successfully
   */
  @Put("/:id")
  async updateSupport(
    @Param("id") id: string,
    @Body() data: UpdateSupportDto,
    @Req() req: any,
    @Res() res: any
  ) {
    try {
      if (!id || !ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid support ID format");
      }

      const support = await this.supportRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!support) {
        throw new NotFoundError("Support request not found");
      }

      if (data.name !== undefined) support.name = data.name.trim();
      if (data.phone !== undefined) support.phone = data.phone.trim();
      if (data.email !== undefined) support.email = data.email.trim();
      if (data.companyName !== undefined) support.companyName = data.companyName.trim();
      if (data.category !== undefined) support.category = data.category.trim();
      if (data.description !== undefined) support.description = data.description.trim();
      if (data.status !== undefined) support.status = data.status;
      if (data.isActive !== undefined) support.isActive = data.isActive;
      if (data.updatedBy !== undefined) {
        support.updatedBy = ObjectId.isValid(data.updatedBy) ? new ObjectId(data.updatedBy) : data.updatedBy;
      } else if (req.user?.userId) {
        support.updatedBy = new ObjectId(req.user.userId);
      }

      const saved = await this.supportRepo.save(support);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Support request updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/support/{id}:
   *   delete:
   *     summary: Delete support request (Mobile - Public)
   *     tags: [Mobile Support]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Support request deleted successfully
   */
  @Delete("/:id")
  async deleteSupport(
    @Param("id") id: string,
    @Req() req: any,
    @Res() res: any
  ) {
    try {
      if (!id || !ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid support ID format");
      }

      const support = await this.supportRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!support) {
        throw new NotFoundError("Support request not found");
      }

      support.isDeleted = true;
      if (req.user?.userId) {
        support.updatedBy = new ObjectId(req.user.userId);
      }

      await this.supportRepo.save(support);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Support request deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
