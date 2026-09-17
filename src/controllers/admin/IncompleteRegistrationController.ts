import {
  JsonController,
  Get,
  Delete,
  Param,
  QueryParam,
  UseBefore,
  NotFoundError,
  BadRequestError,
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { IncompleteRegistration } from "../../entity/IncompleteRegistration";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/incomplete-registrations")
export class AdminIncompleteRegistrationController {
  private repo = AppDataSource.getMongoRepository(IncompleteRegistration);

  /**
   * @swagger
   * /api/admin/incomplete-registrations:
   *   get:
   *     summary: List incomplete registrations with pagination, search, and step filter
   *     tags: [Admin Incomplete Registrations]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Zero-based page index (default 0)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Records per page (default 10)
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search by fullName, mobileNumber, or email
   *       - in: query
   *         name: step
   *         schema:
   *           type: string
   *         description: Filter by registration step (e.g. basic_info, business_info)
   *     responses:
   *       200:
   *         description: Paginated list of incomplete registrations
   */
  @Get("/")
  @UseBefore(AuthMiddleware, canAccess("incomplete_registrations", "view"))
  async list(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("step") step: string,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      if (limit > 100) {
        throw new BadRequestError("limit must not exceed 100");
      }

      const where: any = { isDeleted: false };

      // Filter by registration step
      if (step && step.trim() !== "" && step !== "all") {
        where.step = { $regex: new RegExp(`^${step.trim()}$`, "i") };
      }

      // Search across fullName, mobileNumber, email
      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { fullName: regex },
          { mobileNumber: regex },
          { email: regex }
        ];
      }

      const [records, total] = await this.repo.findAndCount({
        where,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      return pagination(total, records, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/incomplete-registrations/{id}:
   *   get:
   *     summary: Get a single incomplete registration by ID
   *     tags: [Admin Incomplete Registrations]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: MongoDB ObjectId of the record
   *     responses:
   *       200:
   *         description: Incomplete registration record
   *       400:
   *         description: Invalid ID format
   *       404:
   *         description: Record not found
   */
  @Get("/:id")
  @UseBefore(AuthMiddleware, canAccess("incomplete_registrations", "view"))
  async getById(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid incomplete registration ID");
      }

      const record = await this.repo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!record) {
        throw new NotFoundError("Incomplete registration not found");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: record
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/incomplete-registrations/{id}:
   *   delete:
   *     summary: Soft-delete an incomplete registration record
   *     tags: [Admin Incomplete Registrations]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: MongoDB ObjectId of the record to delete
   *     responses:
   *       200:
   *         description: Record deleted successfully
   *       400:
   *         description: Invalid ID format
   *       404:
   *         description: Record not found
   */
  @Delete("/:id")
  @UseBefore(AuthMiddleware, canAccess("incomplete_registrations", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid incomplete registration ID");
      }

      const record = await this.repo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!record) {
        throw new NotFoundError("Incomplete registration not found");
      }

      record.isDeleted = true;
      await this.repo.save(record);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Incomplete registration deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
