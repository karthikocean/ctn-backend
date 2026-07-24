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
import { State } from "../../entity/State";
import { City } from "../../entity/City";
import { resolveRegions, resolveRegion } from "../../utils/region.helper";
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
      const stateRepo = AppDataSource.getMongoRepository(State);
      const cityRepo = AppDataSource.getMongoRepository(City);

      // Check/create State
      let state = await stateRepo.findOne({
        where: {
          name: { $regex: new RegExp(`^${data.state.trim()}$`, "i") },
          country: { $regex: new RegExp(`^${data.country.trim()}$`, "i") },
          isDeleted: false
        }
      });
      if (!state) {
        state = new State();
        state.name = data.state.trim();
        state.country = data.country.trim();
        state.isDeleted = false;
        state = await stateRepo.save(state);
      }

      // Check/create City
      let city = await cityRepo.findOne({
        where: {
          name: { $regex: new RegExp(`^${data.city.trim()}$`, "i") },
          stateId: state._id,
          isDeleted: false
        }
      });
      if (!city) {
        city = new City();
        city.name = data.city.trim();
        city.stateId = state._id;
        city.isDeleted = false;
        city = await cityRepo.save(city);
      }

      // Check for existing region with same country, state, city
      const existing = await this.regionRepo.findOne({
        where: {
          country: data.country.trim(),
          state: state._id,
          city: city._id,
          isDeleted: false
        }
      });

      if (existing) {
        throw new BadRequestError("Region with this country, state and city already exists");
      }

      const region = new BusinessRegion();
      region.country = data.country.trim();
      region.state = state._id;
      region.city = city._id;
      region.status = data.status || region.status;

      // Check for duplicate area names (case-insensitive)
      const areaNames = (data.areas ?? []).map(a => a.name.trim().toLowerCase()).filter(n => n !== "");
      if (areaNames.length !== new Set(areaNames).size) {
        throw new BadRequestError("Duplicate area names are not allowed within a region");
      }

      region.areas = data.areas?.map((e) => ({ _id: new ObjectId(), name: e.name })) ?? [];
      region.isDeleted = false;

      const saved = await this.regionRepo.save(region);
      const resolved = await resolveRegion(saved);

      return res.status(StatusCodes.CREATED).json({
        message: "Business region created successfully",
        data: resolved
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
      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");

        const stateRepo = AppDataSource.getMongoRepository(State);
        const cityRepo = AppDataSource.getMongoRepository(City);

        const matchingStates = await stateRepo.find({
          where: { name: { $regex: regex }, isDeleted: false }
        });
        const matchingCities = await cityRepo.find({
          where: { name: { $regex: regex }, isDeleted: false }
        });

        const matchingStateIds = matchingStates.map(s => s._id);
        const matchingCityIds = matchingCities.map(c => c._id);

        where.$or = [
          { country: { $regex: regex } },
          { state: { $in: matchingStateIds } },
          { city: { $in: matchingCityIds } },
          { "areas.name": { $regex: regex } }
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

      const resolvedRegions = await resolveRegions(regions);

      // Get member counts for each city (case-insensitive)
      const lowerCities = resolvedRegions.map((r) => (r.city ? r.city.toLowerCase() : ""));
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

      const regionsWithCount = resolvedRegions.map((region: any) => ({
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

      const resolved = await resolveRegion(region);
      return res.status(StatusCodes.OK).json(resolved);
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

      if (data.status === "inactive" && region.areas && region.areas.length > 0) {
        const regionIds = region.areas.map((r: any) => new ObjectId(r._id));
        const memberCount = await this.memberRepo.countBy({ businessRegion: { $in: regionIds }, isDeleted: false });
        if (memberCount > 0) {
          throw new BadRequestError("Business region cannot be deactivated as it has active members");
        }
      }

      const stateRepo = AppDataSource.getMongoRepository(State);
      const cityRepo = AppDataSource.getMongoRepository(City);

      let stateId = region.state;
      let cityId = region.city;

      if (data.state || data.country) {
        const targetStateName = data.state ? data.state.trim() : (await stateRepo.findOneBy({ _id: region.state }))?.name || "";
        const targetCountry = data.country || region.country;

        let state = await stateRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${targetStateName}$`, "i") },
            country: { $regex: new RegExp(`^${targetCountry}$`, "i") },
            isDeleted: false
          }
        });
        if (!state && data.state) {
          state = new State();
          state.name = targetStateName;
          state.country = targetCountry;
          state.isDeleted = false;
          state = await stateRepo.save(state);
        }
        if (state) stateId = state._id;
      }

      if (data.city || data.state || data.country) {
        const targetCityName = data.city ? data.city.trim() : (await cityRepo.findOneBy({ _id: region.city }))?.name || "";

        let city = await cityRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${targetCityName}$`, "i") },
            stateId,
            isDeleted: false
          }
        });
        if (!city && data.city) {
          city = new City();
          city.name = targetCityName;
          city.stateId = stateId;
          city.isDeleted = false;
          city = await cityRepo.save(city);
        }
        if (city) cityId = city._id;
      }

      // Check for existing region with same country, state, city (excluding current)
      const existing = await this.regionRepo.findOne({
        where: {
          _id: { $ne: new ObjectId(id) },
          country: data.country || region.country,
          state: stateId,
          city: cityId,
          isDeleted: false
        }
      });

      if (existing) {
        throw new BadRequestError("Region with this country, state and city already exists");
      }

      if (data.status) {
        const city = await cityRepo.findOne({ where: { _id: new ObjectId(region.city) } });
        if (!city) throw new BadRequestError("City is not active");
        await cityRepo.update(city._id, { status: data.status });
      }
      if (data.country) region.country = data.country.trim();
      region.state = stateId;
      region.city = cityId;
      if (data.status) region.status = data.status;
      if (data.areas !== undefined) {
        // Check for duplicate area names (case-insensitive)
        const areaNames = (data.areas ?? []).map((a: any) => a.name.trim().toLowerCase()).filter((n: string) => n !== "");
        if (areaNames.length !== new Set(areaNames).size) {
          throw new BadRequestError("Duplicate area names are not allowed within a region");
        }

        region.areas = data.areas ? data.areas.map((e: any) => {
          const idVal = e._id || e.id;
          return {
            _id: idVal && ObjectId.isValid(idVal) ? new ObjectId(idVal) : new ObjectId(),
            name: e.name
          };
        }) : [];
      }
      const saved = await this.regionRepo.save(region);
      const resolved = await resolveRegion(saved);

      return res.status(StatusCodes.OK).json({
        message: "Business region updated successfully",
        data: resolved
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

      if (region.areas && region.areas.length > 0) {
        const regionIds = region.areas.map((r: any) => new ObjectId(r._id));
        const memberCount = await this.memberRepo.countBy({ businessRegion: { $in: regionIds }, isDeleted: false });
        if (memberCount > 0) {
          throw new BadRequestError("Business region cannot be deleted as it has active members");
        }
      }
      region.isDeleted = true;
      await this.regionRepo.save(region);

      return res.status(StatusCodes.OK).json({ message: "Business region deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
