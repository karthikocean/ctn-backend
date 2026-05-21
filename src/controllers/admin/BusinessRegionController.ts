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
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { Member } from "../../entity/Member";
import { CreateBusinessRegionDto, UpdateBusinessRegionDto } from "../../dto/admin/BusinessRegion.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/business-regions")
@UseBefore(AuthMiddleware)
export class BusinessRegionController {
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/admin/business-regions:
   *   post:
   *     summary: Create a new business region
   *     tags: [BusinessRegion]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateBusinessRegionDto'
   *     responses:
   *       201:
   *         description: Business region created successfully
   */
  @Post("/")
  @UseBefore(canAccess("business_regions", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateBusinessRegionDto, @Res() res: any) {
    try {
      // Check for existing region with same country, state, city
      const existing = await this.regionRepo.findOne({
        where: {
          country: data.country,
          state: data.state,
          city: data.city,
          isDeleted: false
        }
      });

      if (existing) {
        throw new BadRequestError("Region with this country, state and city already exists");
      }

      const region = new BusinessRegion();
      region.country = data.country;
      region.state = data.state;
      region.city = data.city;
      region.status = data.status || region.status;
      region.areas = data.areas?.map((e) => ({ _id: new ObjectId(), name: e.name })) ?? [];
      region.isDeleted = false;

      const saved = await this.regionRepo.save(region);
      return res.status(StatusCodes.CREATED).json({
        message: "Business region created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/business-regions:
   *   get:
   *     summary: Get all business regions with pagination and search
   *     tags: [BusinessRegion]
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
   *         schema: { type: string, enum: [active, inactive] }
   *     responses:
   *       200:
   *         description: List of business regions with member count for each city
   */
  @Get("/")
  @UseBefore(canAccess("business_regions", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (search) {
        where.$or = [
          { country: { $regex: search, $options: "i" } },
          { state: { $regex: search, $options: "i" } },
          { city: { $regex: search, $options: "i" } }
        ];
      }

      if (status) {
        where.status = status;
      }

      const [regions, total] = await this.regionRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Get member counts for each city (case-insensitive)
      const lowerCities = regions.map((r) => (r.city ? r.city.toLowerCase() : ""));
      const memberCounts = await this.memberRepo
        .aggregate([
          {
            $match: {
              isDeleted: false,
              $expr: {
                $in: [{ $toLower: { $ifNull: ["$city", ""] } }, lowerCities]
              }
            }
          },
          {
            $group: {
              _id: { $toLower: "$city" },
              count: { $sum: 1 }
            }
          }
        ])
        .toArray();

      const cityCountMap = memberCounts.reduce((acc: any, curr: any) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});

      const regionsWithCount = regions.map((region: any) => ({
        ...region,
        memberCount: cityCountMap[region.city ? region.city.toLowerCase() : ""] || 0
      }));

      return pagination(total, regionsWithCount, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/business-regions/{id}:
   *   get:
   *     summary: Get a single business region by ID
   *     tags: [BusinessRegion]
   */
  @Get("/:id")
  @UseBefore(canAccess("business_regions", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const region = await this.regionRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!region) throw new NotFoundError("Business region not found");

      return res.status(StatusCodes.OK).json(region);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/business-regions/{id}:
   *   put:
   *     summary: Update a business region
   *     tags: [BusinessRegion]
   */
  @Put("/:id")
  @UseBefore(canAccess("business_regions", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateBusinessRegionDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const region = await this.regionRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!region) throw new NotFoundError("Business region not found");

      const country = data.country || region.country;
      const state = data.state || region.state;
      const city = data.city || region.city;

      // Check for existing region with same country, state, city (excluding current)
      const existing = await this.regionRepo.findOne({
        where: {
          _id: { $ne: new ObjectId(id) },
          country,
          state,
          city,
          isDeleted: false
        }
      });

      if (existing) {
        throw new BadRequestError("Region with this country, state and city already exists");
      }

      if (data.country) region.country = data.country;
      if (data.state) region.state = data.state;
      if (data.city) region.city = data.city;
      if (data.status) region.status = data.status;
      if (data.areas !== undefined) {
        region.areas = data.areas ?? []
      }
      const saved = await this.regionRepo.save(region);
      return res.status(StatusCodes.OK).json({
        message: "Business region updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/business-regions/{id}:
   *   delete:
   *     summary: Delete a business region (Soft Delete)
   *     tags: [BusinessRegion]
   */
  @Delete("/:id")
  @UseBefore(canAccess("business_regions", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const region = await this.regionRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!region) throw new NotFoundError("Business region not found");

      region.isDeleted = true;
      await this.regionRepo.save(region);

      return res.status(StatusCodes.OK).json({ message: "Business region deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
