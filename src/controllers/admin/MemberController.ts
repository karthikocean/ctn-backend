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
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Member, MemberStatus } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { CreateMemberDto } from "../../dto/mobile/Member.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import bcrypt from "bcryptjs";

@JsonController("/members")
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
        const gstCount = await this.memberRepo.countBy({ gstNumber: data.gstNumber, isDeleted: false });
        if (gstCount >= 2) throw new BadRequestError("GST number is already registered with maximum allowed members (2)");
      }

      const member = new Member();
      Object.assign(member, data);

      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);
      if (data.areas && ObjectId.isValid(data.areas)) {
        member.areas = new ObjectId(data.areas);
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
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("city") city: string,
    @QueryParam("category") category: string,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

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
        order: { fullName: "ASC" }
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
        .filter(m => m.state && m.city && m.areas)
        .map(m => ({ state: m.state!, city: m.city! }));

      const uniqueStateCitiesMap = new Map<string, { state: string, city: string }>();
      for (const sc of stateCities) {
        uniqueStateCitiesMap.set(`${sc.state.toLowerCase()}|${sc.city.toLowerCase()}`, sc);
      }
      const uniqueStateCities = Array.from(uniqueStateCitiesMap.values());

      const regionQueries = uniqueStateCities.map(sc => ({
        state: { $regex: new RegExp(`^${sc.state}$`, "i") },
        city: { $regex: new RegExp(`^${sc.city}$`, "i") },
        isDeleted: false
      }));

      const regions = regionQueries.length > 0
        ? await this.businessRegionRepo.find({ where: { $or: regionQueries } as any })
        : [];

      const regionMap = new Map<string, { id: string; name: string }[]>();
      for (const r of regions) {
        regionMap.set(`${r.state.toLowerCase()}|${r.city.toLowerCase()}`, r.areas || []);
      }

      const data = members.map(m => {
        let areaInfo = null;
        if (m.areas && m.state && m.city) {
          const areasList = regionMap.get(`${m.state.toLowerCase()}|${m.city.toLowerCase()}`) || [];
          const matchedArea = areasList.find(a => a.id === m.areas!.toString());
          if (matchedArea) {
            areaInfo = { _id: new ObjectId(matchedArea.id), name: matchedArea.name };
          }
        }
        return {
          ...m,
          businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null,
          subCategory: m.subCategory ? categoryMap.get(m.subCategory.toString()) : null,
          areas: areaInfo || m.areas
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
  async getMemberDetail(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const member = await this.memberRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!member) throw new NotFoundError("Member not found");

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
      if (member.areas && member.state && member.city) {
        const region = await this.businessRegionRepo.findOne({
          where: {
            state: { $regex: new RegExp(`^${member.state}$`, "i") },
            city: { $regex: new RegExp(`^${member.city}$`, "i") },
            isDeleted: false
          }
        });
        const matchedArea = region?.areas?.find(a => a.id === member.areas!.toString());
        populated.areas = matchedArea ? { _id: new ObjectId(matchedArea.id), name: matchedArea.name } : null;
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
  async updateMember(@Param("id") id: string, @Body() data: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      if (data.businessCategory) data.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) data.subCategory = new ObjectId(data.subCategory);
      if (data.hasOwnProperty("areas")) {
        if (data.areas && ObjectId.isValid(data.areas)) {
          data.areas = new ObjectId(data.areas);
        } else {
          data.areas = null;
        }
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
  async updateStatus(@Param("id") id: string, @Body() data: { status: MemberStatus }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

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
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

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
