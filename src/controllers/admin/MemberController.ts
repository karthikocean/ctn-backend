import {
  JsonController,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member, MemberStatus } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { BusinessRegion, Area } from "../../entity/BusinessRegion";
import { State } from "../../entity/State";
import { City } from "../../entity/City";
import { CreateMemberDto } from "../../dto/mobile/Member.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import bcrypt from "bcryptjs";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";

@JsonController("/members")
@UseBefore(AuthMiddleware, franchiseFilter)
export class AdminMemberController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);

  /**
   * @swagger
   * /api/admin/members/register:
   *   post:
   *     summary: Register a new member (Admin)
   *     tags: [Admin Member]
   */
  @Post("/register")
  @HttpCode(StatusCodes.CREATED)
  async register(@Req() req: any, @Body() data: CreateMemberDto, @Res() res: any) {
    try {
      const existingMobile = await this.memberRepo.findOneBy({ mobileNumber: data.mobileNumber, isDeleted: false });
      if (existingMobile) throw new BadRequestError("Mobile number already registered");

      if (data.email) {
        const existingEmail = await this.memberRepo.findOneBy({ email: data.email, isDeleted: false });
        if (existingEmail) throw new BadRequestError("Email already registered");
      }

      if (data.gstNumber) {
        const gstCount = await this.memberRepo.count({ gstNumber: data.gstNumber, isDeleted: false });
        if (gstCount >= 2) throw new BadRequestError("GST number is already registered with maximum allowed members (2)");
      }

      const member = new Member();
      Object.assign(member, data);

      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);
      if (data.businessRegion && ObjectId.isValid(data.businessRegion)) {
        member.businessRegion = new ObjectId(data.businessRegion);
      } else if ((data as any).areas && ObjectId.isValid((data as any).areas)) {
        member.businessRegion = new ObjectId((data as any).areas);
      }

      member.isDeleted = false;
      member.status = MemberStatus.ACTIVE;
      member.pin = await bcrypt.hash("1234", 10); // Default PIN hashed for members registered by Admin

      const saved = await this.memberRepo.save(member);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Registration successful",
        data: saved._id
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/members:
   *   get:
   *     summary: Get member directory with filters (Admin)
   *     tags: [Admin Member]
   */
  @Get("/")
  async getDirectory(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("city") city: string,
    @QueryParam("category") category: string,
    @QueryParam("status") status: string,
    @QueryParam("regionId") regionId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (regionId && ObjectId.isValid(regionId)) {
        const businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
        const region = await businessRegionRepo.findOne({
          where: { _id: new ObjectId(regionId), isDeleted: false }
        });
        if (region) {
          const areaIds: ObjectId[] = [region._id];
          if (region.areas && Array.isArray(region.areas)) {
            region.areas.forEach((area: any) => {
              if (area._id) areaIds.push(new ObjectId(area._id));
            });
          }
          if (req.isFranchise) {
            const franchiseAreaIdStrings = new Set(req.franchiseAreaIds.map((id: any) => id.toString()));
            const intersectedAreaIds = areaIds.filter(id => franchiseAreaIdStrings.has(id.toString()));
            where.businessRegion = { $in: intersectedAreaIds };
          } else {
            where.businessRegion = { $in: areaIds };
          }
        } else {
          where.businessRegion = new ObjectId(regionId);
        }
      } else if (req.isFranchise) {
        if (req.franchiseAreaIds && req.franchiseAreaIds.length > 0) {
          where.businessRegion = { $in: req.franchiseAreaIds };
        } else {
          where.businessRegion = new ObjectId();
        }
      }

      if (status) {
        where.status = status;
      }

      if (search) {
        where.$or = [
          { fullName: { $regex: search, $options: "i" } },
          { businessName: { $regex: search, $options: "i" } },
          { city: { $regex: search, $options: "i" } },
          { mobileNumber: { $regex: search, $options: "i" } }
        ];
      }
      if (city) where.city = city;
      if (category) where.businessCategory = new ObjectId(category);

      const [members, total] = await this.memberRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { updatedAt: "DESC" }
      });

      // Populate Categories
      const categoryIds = members
        .flatMap(m => [m.businessCategory, m.subCategory])
        .filter((id): id is ObjectId => !!id);

      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), { _id: c._id, name: c.name }]));

      // Populate Areas
      const stateCities = members
        .filter(m => m.state && m.city && m.businessRegion)
        .map(m => ({ state: m.state!, city: m.city! }));

      const uniqueStateCitiesMap = new Map<string, { state: string, city: string }>();
      for (const sc of stateCities) {
        uniqueStateCitiesMap.set(`${sc.state.toLowerCase()}|${sc.city.toLowerCase()}`, sc);
      }
      const uniqueStateCities = Array.from(uniqueStateCitiesMap.values());
      const stateNames = uniqueStateCities.map(sc => sc.state);
      const cityNames = uniqueStateCities.map(sc => sc.city);

      const stateRepo = AppDataSource.getMongoRepository(State);
      const cityRepo = AppDataSource.getMongoRepository(City);

      const matchingStates = stateNames.length > 0
        ? await stateRepo.find({
          where: {
            name: { $in: stateNames.map(name => new RegExp(`^${name}$`, "i")) },
            isDeleted: false
          }
        })
        : [];

      const matchingCities = cityNames.length > 0
        ? await cityRepo.find({
          where: {
            name: { $in: cityNames.map(name => new RegExp(`^${name}$`, "i")) },
            isDeleted: false
          }
        })
        : [];

      const stateIdMap = new Map(matchingStates.map(s => [s._id.toString(), s.name.toLowerCase()]));
      const cityIdMap = new Map(matchingCities.map(c => [c._id.toString(), c.name.toLowerCase()]));

      const stateIds = matchingStates.map(s => s._id);
      const cityIds = matchingCities.map(c => c._id);

      const regions = (stateIds.length > 0 && cityIds.length > 0)
        ? await this.businessRegionRepo.find({
          where: {
            state: { $in: stateIds },
            city: { $in: cityIds },
            isDeleted: false
          } as any
        })
        : [];

      const regionMap = new Map<string, Area[]>();
      for (const r of regions) {
        const stateName = stateIdMap.get(r.state.toString()) || "";
        const cityName = cityIdMap.get(r.city.toString()) || "";
        regionMap.set(`${stateName}|${cityName}`, r.areas || []);
      }

      const data = members.map(m => {
        let areaInfo = null;
        if (m.businessRegion && m.state && m.city) {
          const areasList = regionMap.get(`${m.state.toLowerCase()}|${m.city.toLowerCase()}`) || [];
          const matchedArea = areasList.find(a => a._id?.toString() === m.businessRegion!.toString());
          if (matchedArea) {
            areaInfo = { _id: matchedArea._id, name: matchedArea.name };
          }
        }
        return {
          ...m,
          businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null,
          subCategory: m.subCategory ? categoryMap.get(m.subCategory.toString()) : null,
          businessRegion: areaInfo || m.businessRegion
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/members/{id}:
   *   get:
   *     summary: Get member detail (Admin)
   *     tags: [Admin Member]
   */
  @Get("/:id")
  async getMemberDetail(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const member = await this.memberRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!member) throw new NotFoundError("Member not found");

      if (req.isFranchise) {
        const regionId = member.businessRegion;
        if (!regionId || !req.franchiseAreaIds.some((areaId: ObjectId) => areaId.toString() === regionId.toString())) {
          throw new NotFoundError("Member not found");
        }
      }

      // Populate Categories
      const populated: any = { ...member };
      if (member.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: member.businessCategory });
        populated.businessCategory = cat ? { _id: cat._id, name: cat.name } : null;
      }
      if (member.subCategory) {
        const subCat = await this.categoryRepo.findOneBy({ _id: member.subCategory });
        populated.subCategory = subCat ? { _id: subCat._id, name: subCat.name } : null;
      }
      if (member.businessRegion && member.state && member.city) {
        const stateRepo = AppDataSource.getMongoRepository(State);
        const cityRepo = AppDataSource.getMongoRepository(City);
        const stateDoc = await stateRepo.findOne({
          where: { name: { $regex: new RegExp(`^${member.state}$`, "i") }, isDeleted: false }
        });
        let region = null;
        if (stateDoc) {
          const cityDoc = await cityRepo.findOne({
            where: { name: { $regex: new RegExp(`^${member.city}$`, "i") }, stateId: stateDoc._id, isDeleted: false }
          });
          if (cityDoc) {
            region = await this.businessRegionRepo.findOne({
              where: {
                state: stateDoc._id,
                city: cityDoc._id,
                isDeleted: false
              }
            });
          }
        }
        const matchedArea = region?.areas?.find(a => a._id?.toString() === member.businessRegion!.toString());
        populated.businessRegion = matchedArea ? { _id: matchedArea._id, name: matchedArea.name } : null;
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: populated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/members/{id}:
   *   put:
   *     summary: Update member details (Admin)
   *     tags: [Admin Member]
   */
  @Put("/:id")
  async updateMember(@Req() req: any, @Param("id") id: string, @Body() data: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      if (req.isFranchise) {
        const regionId = member.businessRegion;
        if (!regionId || !req.franchiseAreaIds.some((areaId: ObjectId) => areaId.toString() === regionId.toString())) {
          throw new NotFoundError("Member not found");
        }
      }

      if (data.businessCategory) data.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) data.subCategory = new ObjectId(data.subCategory);
      if (data.hasOwnProperty("businessRegion")) {
        if (data.businessRegion && ObjectId.isValid(data.businessRegion)) {
          data.businessRegion = new ObjectId(data.businessRegion);
        } else {
          data.businessRegion = null;
        }
      }
      if (data.hasOwnProperty("areas")) {
        if (data.areas && ObjectId.isValid(data.areas)) {
          data.businessRegion = new ObjectId(data.areas);
        } else {
          data.businessRegion = null;
        }
        delete data.areas;
      }

      Object.assign(member, data);

      const saved = await this.memberRepo.save(member);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Member updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/members/{id}/status:
   *   put:
   *     summary: Update member status (Approve/Reject)
   *     tags: [Admin Member]
   */
  @Put("/:id/status")
  async updateStatus(@Req() req: any, @Param("id") id: string, @Body() data: { status: MemberStatus }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      if (req.isFranchise) {
        const regionId = member.businessRegion;
        if (!regionId || !req.franchiseAreaIds.some((areaId: ObjectId) => areaId.toString() === regionId.toString())) {
          throw new NotFoundError("Member not found");
        }
      }

      member.status = data.status;
      await this.memberRepo.save(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Member status updated to ${data.status}`
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/members/{id}:
   *   delete:
   *     summary: Soft delete a member (Admin)
   *     tags: [Admin Member]
   */
  @Delete("/:id")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      if (req.isFranchise) {
        const regionId = member.businessRegion;
        if (!regionId || !req.franchiseAreaIds.some((areaId: ObjectId) => areaId.toString() === regionId.toString())) {
          throw new NotFoundError("Member not found");
        }
      }

      member.isDeleted = true;
      await this.memberRepo.save(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Member deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
