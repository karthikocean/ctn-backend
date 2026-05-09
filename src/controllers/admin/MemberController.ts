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

      const data = members.map(m => ({
        ...m,
        businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null,
        subCategory: m.subCategory ? categoryMap.get(m.subCategory.toString()) : null,
      }));

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
