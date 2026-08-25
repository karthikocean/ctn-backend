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
import { Enquiry, EnquiryStatus } from "../../entity/Enquiry";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/enquiries")
export class AdminEnquiryController {
  private enquiryRepo = AppDataSource.getMongoRepository(Enquiry);

  @Get("/stats")
  @UseBefore(AuthMiddleware, canAccess("enquiries", "view"))
  async getStats(@Res() res: any) {
    try {
      const [total, pending, inProgress, resolved, rejected] = await Promise.all([
        this.enquiryRepo.countBy({ isDeleted: false }),
        this.enquiryRepo.countBy({ status: EnquiryStatus.PENDING, isDeleted: false }),
        this.enquiryRepo.countBy({ status: EnquiryStatus.IN_PROGRESS, isDeleted: false }),
        this.enquiryRepo.countBy({ status: EnquiryStatus.RESOLVED, isDeleted: false }),
        this.enquiryRepo.countBy({ status: EnquiryStatus.REJECTED, isDeleted: false })
      ]);

      return res.status(StatusCodes.OK).json({
        total,
        pending,
        inProgress,
        resolved,
        rejected
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/")
  @UseBefore(AuthMiddleware, canAccess("enquiries", "view"))
  async getEnquiries(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("enquiryType") enquiryType: string,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        isDeleted: false
      };

      if (enquiryType && enquiryType.trim() !== "" && enquiryType !== "all") {
        where.enquiryType = { $regex: new RegExp(`^${enquiryType.trim()}$`, "i") };
      }

      if (status && status.trim() !== "" && status !== "all") {
        where.status = status.trim();
      }

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { name: regex },
          { email: regex },
          { phoneNumber: regex },
          { city: regex },
          { companyName: regex },
          { comment: regex }
        ];
      }

      const [enquiries, total] = await this.enquiryRepo.findAndCount({
        where,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      return pagination(total, enquiries, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/:id")
  @UseBefore(AuthMiddleware, canAccess("enquiries", "view"))
  async getEnquiryById(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Enquiry ID");
      }

      const enquiry = await this.enquiryRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!enquiry) {
        throw new NotFoundError("Enquiry not found");
      }

      return res.status(StatusCodes.OK).json(enquiry);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Patch("/:id/status")
  @UseBefore(AuthMiddleware, canAccess("enquiries", "edit"))
  async updateStatus(
    @Param("id") id: string,
    @Body() body: { status: EnquiryStatus; adminNote?: string },
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Enquiry ID");
      }

      const enquiry = await this.enquiryRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!enquiry) {
        throw new NotFoundError("Enquiry not found");
      }

      if (body.status) {
        if (!Object.values(EnquiryStatus).includes(body.status)) {
          throw new BadRequestError("Invalid status value");
        }
        enquiry.status = body.status;
      }

      if (body.adminNote !== undefined) {
        enquiry.adminNote = body.adminNote;
      }

      const updated = await this.enquiryRepo.save(enquiry);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Enquiry status updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Delete("/:id")
  @UseBefore(AuthMiddleware, canAccess("enquiries", "delete"))
  async deleteEnquiry(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid Enquiry ID");
      }

      const enquiry = await this.enquiryRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!enquiry) {
        throw new NotFoundError("Enquiry not found");
      }

      enquiry.isDeleted = true;
      await this.enquiryRepo.save(enquiry);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Enquiry deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
