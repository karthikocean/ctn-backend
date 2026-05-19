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
import { Franchise, FranchiseStatus } from "../../entity/Franchise";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { AdminUser } from "../../entity/AdminUser";
import { CreateFranchiseDto, UpdateFranchiseDto } from "../../dto/admin/Franchise.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/franchises")
@UseBefore(AuthMiddleware)
export class FranchiseController {
  private franchiseRepo = AppDataSource.getMongoRepository(Franchise);
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private adminUserRepo = AppDataSource.getMongoRepository(AdminUser);

  /**
   * @swagger
   * /api/admin/franchises:
   *   post:
   *     summary: Create a new franchise
   *     tags: [Franchise]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               businessRegionId:
   *                 type: string
   *               userId:
   *                 type: array
   *                 items:
   *                   type: string
   *               status:
   *                 type: string
   *                 enum: [active, inactive]
   *     responses:
   *       201:
   *         description: Franchise created successfully
   */
  @Post("/")
  @UseBefore(canAccess("franchises", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateFranchiseDto, @Res() res: any) {
    try {
      // Validate business region
      if (!ObjectId.isValid(data.businessRegionId)) {
        throw new BadRequestError("Invalid businessRegionId");
      }
      const region = await this.regionRepo.findOneBy({
        _id: new ObjectId(data.businessRegionId),
        isDeleted: false
      });
      if (!region) {
        throw new NotFoundError("Business region not found");
      }

      // Check if duplicate franchise name exists
      const existing = await this.franchiseRepo.findOne({
        where: {
          name: { $regex: `^${data.name.trim()}$`, $options: "i" },
          isDeleted: false
        }
      });
      if (existing) {
        throw new BadRequestError("Franchise with this name already exists");
      }

      // Validate userIds if provided
      let userObjectIds: ObjectId[] = [];
      if (data.userId && data.userId.length > 0) {
        for (const uid of data.userId) {
          if (!ObjectId.isValid(uid)) {
            throw new BadRequestError(`Invalid userId: ${uid}`);
          }
          userObjectIds.push(new ObjectId(uid));
        }

        // Verify users exist
        const usersCount = await this.adminUserRepo.count({
          _id: { $in: userObjectIds },
          isDeleted: false
        } as any);
        if (usersCount !== userObjectIds.length) {
          throw new BadRequestError("One or more userIds are invalid or do not exist");
        }
      }

      const franchise = new Franchise();
      franchise.name = data.name.trim();
      franchise.businessRegionId = new ObjectId(data.businessRegionId);
      franchise.userId = userObjectIds;
      franchise.status = data.status || FranchiseStatus.ACTIVE;
      franchise.isDeleted = false;

      const saved = await this.franchiseRepo.save(franchise);

      return res.status(StatusCodes.CREATED).json({
        message: "Franchise created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises:
   *   get:
   *     summary: Get all franchises with pagination, search, and filters
   *     tags: [Franchise]
   */
  @Get("/")
  @UseBefore(canAccess("franchises", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: string,
    @QueryParam("businessRegionId") businessRegionId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (search) {
        where.name = { $regex: search, $options: "i" };
      }

      if (status) {
        where.status = status;
      }

      if (businessRegionId) {
        if (!ObjectId.isValid(businessRegionId)) {
          throw new BadRequestError("Invalid businessRegionId");
        }
        where.businessRegionId = new ObjectId(businessRegionId);
      }

      const [franchises, total] = await this.franchiseRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Populate Business Regions
      const regionIds = franchises
        .map(f => f.businessRegionId)
        .filter((id): id is ObjectId => !!id);

      const regions = regionIds.length > 0
        ? await this.regionRepo.find({ where: { _id: { $in: regionIds } } as any })
        : [];

      const regionMap = new Map(
        regions.map(r => [r._id.toString(), { _id: r._id, country: r.country, state: r.state, city: r.city }])
      );

      // Populate AdminUsers (Users)
      const userIds = franchises
        .flatMap(f => f.userId || [])
        .filter((id): id is ObjectId => !!id);

      const adminUsers = userIds.length > 0
        ? await this.adminUserRepo.find({ where: { _id: { $in: userIds } } as any })
        : [];

      const userMap = new Map(
        adminUsers.map(u => [u.id.toString(), { _id: u.id, fullName: u.name, email: u.email, mobileNumber: u.phoneNumber }])
      );

      const populated = franchises.map(f => ({
        ...f,
        businessRegion: f.businessRegionId ? regionMap.get(f.businessRegionId.toString()) : null,
        users: (f.userId || []).map(uid => userMap.get(uid.toString())).filter(Boolean)
      }));

      return pagination(total, populated, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises/{id}:
   *   get:
   *     summary: Get a franchise by ID
   *     tags: [Franchise]
   */
  @Get("/:id")
  @UseBefore(canAccess("franchises", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const franchise = await this.franchiseRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!franchise) throw new NotFoundError("Franchise not found");

      // Populate Business Region
      let businessRegion = null;
      if (franchise.businessRegionId) {
        const region = await this.regionRepo.findOneBy({ _id: franchise.businessRegionId, isDeleted: false });
        if (region) {
          businessRegion = { _id: region._id, country: region.country, state: region.state, city: region.city };
        }
      }

      // Populate Users
      let users: any[] = [];
      if (franchise.userId && franchise.userId.length > 0) {
        const adminUsers = await this.adminUserRepo.find({
          where: { _id: { $in: franchise.userId } } as any
        });
        users = adminUsers.map(u => ({ _id: u.id, fullName: u.name, email: u.email, mobileNumber: u.phoneNumber }));
      }

      return res.status(StatusCodes.OK).json({
        ...franchise,
        businessRegion,
        users
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises/{id}:
   *   put:
   *     summary: Update a franchise
   *     tags: [Franchise]
   */
  @Put("/:id")
  @UseBefore(canAccess("franchises", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateFranchiseDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const franchise = await this.franchiseRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!franchise) throw new NotFoundError("Franchise not found");

      if (data.name) {
        const trimmedName = data.name.trim();
        // Check duplicate name excluding current
        const existing = await this.franchiseRepo.findOne({
          where: {
            _id: { $ne: new ObjectId(id) },
            name: { $regex: `^${trimmedName}$`, $options: "i" },
            isDeleted: false
          }
        });
        if (existing) {
          throw new BadRequestError("Franchise with this name already exists");
        }
        franchise.name = trimmedName;
      }

      if (data.businessRegionId) {
        if (!ObjectId.isValid(data.businessRegionId)) {
          throw new BadRequestError("Invalid businessRegionId");
        }
        const region = await this.regionRepo.findOneBy({
          _id: new ObjectId(data.businessRegionId),
          isDeleted: false
        });
        if (!region) {
          throw new NotFoundError("Business region not found");
        }
        franchise.businessRegionId = new ObjectId(data.businessRegionId);
      }

      if (data.userId !== undefined) {
        let userObjectIds: ObjectId[] = [];
        if (data.userId.length > 0) {
          for (const uid of data.userId) {
            if (!ObjectId.isValid(uid)) {
              throw new BadRequestError(`Invalid userId: ${uid}`);
            }
            userObjectIds.push(new ObjectId(uid));
          }          // Verify users exist
          const usersCount = await this.adminUserRepo.count({
            _id: { $in: userObjectIds },
            isDeleted: false
          } as any);

          if (usersCount !== userObjectIds.length) {
            throw new BadRequestError("One or more userIds are invalid or do not exist");
          }
        }
        franchise.userId = userObjectIds;
      }

      if (data.status) {
        franchise.status = data.status;
      }

      const saved = await this.franchiseRepo.save(franchise);

      return res.status(StatusCodes.OK).json({
        message: "Franchise updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/franchises/{id}:
   *   delete:
   *     summary: Soft delete a franchise
   *     tags: [Franchise]
   */
  @Delete("/:id")
  @UseBefore(canAccess("franchises", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const franchise = await this.franchiseRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!franchise) throw new NotFoundError("Franchise not found");

      franchise.isDeleted = true;
      await this.franchiseRepo.save(franchise);

      return res.status(StatusCodes.OK).json({
        message: "Franchise deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
