import {
  JsonController,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  QueryParam,
  UseBefore,
  NotFoundError,
  BadRequestError,
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { FranchiseApplication, FranchiseApplicationStatus } from "../../entity/FranchiseApplication";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/franchise-applications")
export class AdminFranchiseApplicationController {
  private applicationRepo = AppDataSource.getMongoRepository(FranchiseApplication);

  @Get("/stats")
  @UseBefore(AuthMiddleware, canAccess("franchise_applications", "view"))
  async getStats(@Res() res: any) {
    try {
      const [total, pending, underReview, approved, rejected] = await Promise.all([
        this.applicationRepo.countBy({ isDeleted: false }),
        this.applicationRepo.countBy({ status: FranchiseApplicationStatus.PENDING, isDeleted: false }),
        this.applicationRepo.countBy({ status: FranchiseApplicationStatus.UNDER_REVIEW, isDeleted: false }),
        this.applicationRepo.countBy({ status: FranchiseApplicationStatus.APPROVED, isDeleted: false }),
        this.applicationRepo.countBy({ status: FranchiseApplicationStatus.REJECTED, isDeleted: false })
      ]);

      return res.status(StatusCodes.OK).json({
        total,
        pending,
        underReview,
        approved,
        rejected
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/")
  @UseBefore(AuthMiddleware, canAccess("franchise_applications", "view"))
  async getApplications(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("state") state: string,
    @QueryParam("city") city: string,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        isDeleted: false
      };

      if (state && state.trim() !== "" && state !== "all") {
        where.state = { $regex: new RegExp(`^${state.trim()}$`, "i") };
      }

      if (city && city.trim() !== "" && city !== "all") {
        where.city = { $regex: new RegExp(`^${city.trim()}$`, "i") };
      }

      if (status && status.trim() !== "" && status !== "all") {
        where.status = status.trim();
      }

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { fullName: regex },
          { email: regex },
          { phoneNumber: regex },
          { state: regex },
          { city: regex },
          { companyName: regex }
        ];
      }

      const [applications, total] = await this.applicationRepo.findAndCount({
        where,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      return pagination(total, applications, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/:id")
  @UseBefore(AuthMiddleware, canAccess("franchise_applications", "view"))
  async getApplicationById(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Application ID");
      }

      const application = await this.applicationRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!application) {
        throw new NotFoundError("Franchise application not found");
      }

      return res.status(StatusCodes.OK).json(application);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Patch("/:id/status")
  @UseBefore(AuthMiddleware, canAccess("franchise_applications", "edit"))
  async updateStatus(
    @Param("id") id: string,
    @Body() body: { status: FranchiseApplicationStatus; adminNote?: string },
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Application ID");
      }

      const application = await this.applicationRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!application) {
        throw new NotFoundError("Franchise application not found");
      }

      if (body.status) {
        if (!Object.values(FranchiseApplicationStatus).includes(body.status)) {
          throw new BadRequestError("Invalid status value");
        }
        application.status = body.status;
      }

      if (body.adminNote !== undefined) {
        application.adminNote = body.adminNote;
      }

      const updated = await this.applicationRepo.save(application);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Application status updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Delete("/:id")
  @UseBefore(AuthMiddleware, canAccess("franchise_applications", "delete"))
  async deleteApplication(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Application ID");
      }

      const application = await this.applicationRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!application) {
        throw new NotFoundError("Franchise application not found");
      }

      application.isDeleted = true;
      await this.applicationRepo.save(application);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Franchise application deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
