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
import { FranchiseApplication, FranchiseApplicationStatus } from "../../entity/FranchiseApplication";
import { CreateFranchiseApplicationDto, UpdateFranchiseApplicationDto } from "../../dto/website/FranchiseApplication.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

/**
 * @swagger
 * tags:
 *   name: Website Franchise Applications
 *   description: Website franchise application form APIs
 */

@JsonController("/franchise-applications")
export class WebsiteFranchiseApplicationController {
  private applicationRepo = AppDataSource.getMongoRepository(FranchiseApplication);

  /**
   * @swagger
   * /website-api/franchise-applications:
   *   post:
   *     summary: Submit a franchise application
   *     tags: [Website Franchise Applications]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateFranchiseApplicationDto'
   *     responses:
   *       210:
   *         description: Application submitted successfully
   *       400:
   *         description: Validation error or invalid input
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async createApplication(@Body() data: CreateFranchiseApplicationDto, @Res() res: any) {
    try {
      const application = new FranchiseApplication();
      application.fullName = data.fullName.trim();
      application.phoneNumber = data.phoneNumber.trim();
      application.email = data.email.trim().toLowerCase();
      application.state = data.state.trim();
      application.city = data.city.trim();
      application.companyName = data.companyName.trim();
      application.status = FranchiseApplicationStatus.PENDING;
      application.isDeleted = false;

      const saved = await this.applicationRepo.save(application);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Franchise application submitted successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/franchise-applications:
   *   get:
   *     summary: Get all franchise applications with filters and pagination
   *     tags: [Website Franchise Applications]
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
   *         description: Search query for full name, email, phone number, state, city, or company name
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *         description: Filter by state
   *       - in: query
   *         name: city
   *         schema:
   *           type: string
   *         description: Filter by city
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [PENDING, UNDER_REVIEW, APPROVED, REJECTED]
   *         description: Filter by application status
   *     responses:
   *       200:
   *         description: List of franchise applications retrieved successfully
   */
  @Get("/")
  async getApplications(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("state") state: string,
    @QueryParam("city") city: string,
    @QueryParam("status") status: FranchiseApplicationStatus,
    @Res() res: any
  ) {
    try {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        isDeleted: false
      };

      if (state) {
        where.state = state;
      }

      if (city) {
        where.city = city;
      }

      if (status) {
        where.status = status;
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

  /**
   * @swagger
   * /website-api/franchise-applications/{id}:
   *   get:
   *     summary: Get details of a single franchise application by ID
   *     tags: [Website Franchise Applications]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Franchise application ObjectId
   *     responses:
   *       200:
   *         description: Application details retrieved successfully
   *       404:
   *         description: Application not found
   */
  @Get("/:id")
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

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Franchise application retrieved successfully",
        data: application
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/franchise-applications/{id}:
   *   put:
   *     summary: Update a franchise application by ID
   *     tags: [Website Franchise Applications]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Franchise application ObjectId
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateFranchiseApplicationDto'
   *     responses:
   *       200:
   *         description: Application updated successfully
   *       404:
   *         description: Application not found
   */
  @Put("/:id")
  async updateApplication(
    @Param("id") id: string,
    @Body() data: UpdateFranchiseApplicationDto,
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

      if (data.fullName !== undefined) application.fullName = data.fullName.trim();
      if (data.phoneNumber !== undefined) application.phoneNumber = data.phoneNumber.trim();
      if (data.email !== undefined) application.email = data.email.trim().toLowerCase();
      if (data.state !== undefined) application.state = data.state.trim();
      if (data.city !== undefined) application.city = data.city.trim();
      if (data.companyName !== undefined) application.companyName = data.companyName.trim();
      if (data.status !== undefined) application.status = data.status;
      if (data.adminNote !== undefined) application.adminNote = data.adminNote.trim();

      const updated = await this.applicationRepo.save(application);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Franchise application updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /website-api/franchise-applications/{id}:
   *   delete:
   *     summary: Soft delete a franchise application by ID
   *     tags: [Website Franchise Applications]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Franchise application ObjectId
   *     responses:
   *       200:
   *         description: Application deleted successfully
   *       404:
   *         description: Application not found
   */
  @Delete("/:id")
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
