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
import { Enquiry, EnquiryStatus } from "../../entity/Enquiry";
import { CreateEnquiryDto, UpdateEnquiryDto } from "../../dto/website/Enquiry.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

/**
 * @swagger
 * tags:
 *   name: Website Enquiries
 *   description: Website contact enquiry APIs
 */

@JsonController("/enquiries")
export class WebsiteEnquiryController {
  private enquiryRepo = AppDataSource.getMongoRepository(Enquiry);

  /**
   * @swagger
   * /website-api/enquiries:
   *   post:
   *     summary: Submit a website enquiry
   *     tags: [Website Enquiries]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateEnquiryDto'
   *     responses:
   *       210:
   *         description: Enquiry submitted successfully
   *       400:
   *         description: Validation error or invalid input
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async createEnquiry(@Body() data: CreateEnquiryDto, @Res() res: any) {
    try {
      const enquiry = new Enquiry();
      enquiry.name = data.name.trim();
      enquiry.email = data.email.trim().toLowerCase();
      enquiry.phoneNumber = data.phoneNumber.trim();
      enquiry.enquiryType = data.enquiryType?.trim();
      enquiry.city = data.city?.trim();
      enquiry.companyName = data.companyName?.trim();
      enquiry.comment = data.comment?.trim();
      enquiry.status = EnquiryStatus.PENDING;
      enquiry.isDeleted = false;

      const saved = await this.enquiryRepo.save(enquiry);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Enquiry submitted successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/enquiries:
   *   get:
   *     summary: Get all website enquiries with filters and pagination
   *     tags: [Website Enquiries]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page index (0-based)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Number of items per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search query for name, email, phone number, city, or company
   *       - in: query
   *         name: enquiryType
   *         schema:
   *           type: string
   *         description: Filter by enquiry type
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [PENDING, IN_PROGRESS, RESOLVED, REJECTED]
   *         description: Filter by enquiry status
   *     responses:
   *       200:
   *         description: List of enquiries retrieved successfully
   */
  @Get("/")
  async getEnquiries(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("enquiryType") enquiryType: string,
    @QueryParam("status") status: EnquiryStatus,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        isDeleted: false
      };

      if (enquiryType) {
        where.enquiryType = enquiryType;
      }

      if (status) {
        where.status = status;
      }

      if (search && search.trim() !== "") {
        const regex = new RegExp(search.trim(), "i");
        where.$or = [
          { name: regex },
          { email: regex },
          { phoneNumber: regex },
          { city: regex },
          { companyName: regex }
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

  /**
   * @swagger
   * /website-api/enquiries/{id}:
   *   get:
   *     summary: Get details of a single enquiry by ID
   *     tags: [Website Enquiries]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Enquiry ObjectId
   *     responses:
   *       200:
   *         description: Enquiry details retrieved successfully
   *       404:
   *         description: Enquiry not found
   */
  @Get("/:id")
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

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Enquiry retrieved successfully",
        data: enquiry
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/enquiries/{id}:
   *   put:
   *     summary: Update an enquiry by ID
   *     tags: [Website Enquiries]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Enquiry ObjectId
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateEnquiryDto'
   *     responses:
   *       200:
   *         description: Enquiry updated successfully
   *       404:
   *         description: Enquiry not found
   */
  @Put("/:id")
  async updateEnquiry(
    @Param("id") id: string,
    @Body() data: UpdateEnquiryDto,
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

      if (data.name !== undefined) enquiry.name = data.name.trim();
      if (data.email !== undefined) enquiry.email = data.email.trim().toLowerCase();
      if (data.phoneNumber !== undefined) enquiry.phoneNumber = data.phoneNumber.trim();
      if (data.enquiryType !== undefined) enquiry.enquiryType = data.enquiryType.trim();
      if (data.city !== undefined) enquiry.city = data.city.trim();
      if (data.companyName !== undefined) enquiry.companyName = data.companyName.trim();
      if (data.comment !== undefined) enquiry.comment = data.comment.trim();
      if (data.status !== undefined) enquiry.status = data.status;
      if (data.adminNote !== undefined) enquiry.adminNote = data.adminNote.trim();

      const updated = await this.enquiryRepo.save(enquiry);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Enquiry updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/enquiries/{id}:
   *   delete:
   *     summary: Soft delete an enquiry by ID
   *     tags: [Website Enquiries]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Enquiry ObjectId
   *     responses:
   *       200:
   *         description: Enquiry deleted successfully
   *       404:
   *         description: Enquiry not found
   */
  @Delete("/:id")
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
