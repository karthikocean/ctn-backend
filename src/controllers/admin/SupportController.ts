import {
  JsonController,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  QueryParam,
  UseBefore,
  NotFoundError,
  BadRequestError,
  Res,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Support, SupportStatus } from "../../entity/Support";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { UpdateSupportStatusDto, AdminUpdateSupportDto } from "../../dto/admin/Support.dto";

@JsonController("/supports")
export class AdminSupportController {
  private supportRepo = AppDataSource.getMongoRepository(Support);

  /**
   * @swagger
   * /api/admin/supports/stats:
   *   get:
   *     summary: Get support requests statistics (Admin)
   *     tags: [Admin Support]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Support statistics retrieved successfully
   */
  @Get("/stats")
  @UseBefore(AuthMiddleware)
  async getStats(@Res() res: any) {
    try {
      const [total, pending, inProgress, resolved, closed] = await Promise.all([
        this.supportRepo.countBy({ isDeleted: false }),
        this.supportRepo.countBy({ status: SupportStatus.PENDING, isDeleted: false }),
        this.supportRepo.countBy({ status: SupportStatus.IN_PROGRESS, isDeleted: false }),
        this.supportRepo.countBy({ status: SupportStatus.RESOLVED, isDeleted: false }),
        this.supportRepo.countBy({ status: SupportStatus.CLOSED, isDeleted: false })
      ]);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          total,
          pending,
          inProgress,
          resolved,
          closed
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/supports:
   *   get:
   *     summary: List all support requests with pagination and search (Admin)
   *     tags: [Admin Support]
   *     security:
   *       - bearerAuth: []
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
   *         schema: { type: string, enum: [PENDING, IN_PROGRESS, RESOLVED, CLOSED, all] }
   *       - in: query
   *         name: isActive
   *         schema: { type: boolean }
   *     responses:
   *       200:
   *         description: Support list retrieved successfully
   */
  @Get("/")
  @UseBefore(AuthMiddleware)
  async getSupports(
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: string,
    @QueryParam("isActive") isActive: boolean,
    @Res() res: any
  ) {
    try {
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(500, Number(limitParam) || 10);

      const where: any = { isDeleted: false };

      if (status && status.trim() !== "" && status !== "all") {
        where.status = status.trim();
      }

      if (isActive !== undefined) {
        where.isActive = String(isActive) === "true";
      }

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { name: regex },
          { phone: regex },
          { email: regex },
          { companyName: regex },
          { category: regex },
          { description: regex }
        ];
      }

      const [supports, total] = await this.supportRepo.findAndCount({
        where,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      return pagination(total, supports, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/supports/{id}:
   *   get:
   *     summary: Get single support request details (Admin)
   *     tags: [Admin Support]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Support details retrieved
   *       404:
   *         description: Support request not found
   */
  @Get("/:id")
  @UseBefore(AuthMiddleware)
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
   * /api/admin/supports/{id}/status:
   *   put:
   *     summary: Update support request status (Admin)
   *     tags: [Admin Support]
   *     security:
   *       - bearerAuth: []
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
   *             $ref: '#/components/schemas/UpdateSupportStatusDto'
   *     responses:
   *       200:
   *         description: Status updated successfully
   */
  @Put("/:id/status")
  @Patch("/:id/status")
  @UseBefore(AuthMiddleware)
  async updateStatus(
    @Param("id") id: string,
    @Body() body: UpdateSupportStatusDto,
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

      support.status = body.status;
      if (body.isActive !== undefined) {
        support.isActive = body.isActive;
      }
      if (req.user?.userId) {
        support.updatedBy = new ObjectId(req.user.userId);
      }

      const updated = await this.supportRepo.save(support);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Support request status updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/supports/{id}:
   *   put:
   *     summary: Update support request details (Admin)
   *     tags: [Admin Support]
   *     security:
   *       - bearerAuth: []
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
   *             $ref: '#/components/schemas/AdminUpdateSupportDto'
   *     responses:
   *       200:
   *         description: Support updated successfully
   */
  @Put("/:id")
  @Patch("/:id")
  @UseBefore(AuthMiddleware)
  async updateSupport(
    @Param("id") id: string,
    @Body() body: AdminUpdateSupportDto,
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

      if (body.name !== undefined) support.name = body.name.trim();
      if (body.phone !== undefined) support.phone = body.phone.trim();
      if (body.email !== undefined) support.email = body.email.trim();
      if (body.companyName !== undefined) support.companyName = body.companyName.trim();
      if (body.category !== undefined) support.category = body.category.trim();
      if (body.description !== undefined) support.description = body.description.trim();
      if (body.status !== undefined) support.status = body.status;
      if (body.isActive !== undefined) support.isActive = body.isActive;

      if (req.user?.userId) {
        support.updatedBy = new ObjectId(req.user.userId);
      }

      const updated = await this.supportRepo.save(support);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Support request updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/supports/{id}:
   *   delete:
   *     summary: Delete support request (Admin)
   *     tags: [Admin Support]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Support deleted successfully
   */
  @Delete("/:id")
  @UseBefore(AuthMiddleware)
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
