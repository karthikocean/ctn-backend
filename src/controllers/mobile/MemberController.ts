import {
  JsonController,
  Get,
  Put,
  Post,
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
import { CreateMemberDto, UpdateProfileDto } from "../../dto/mobile/Member.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import imageService from "../../utils/upload";
import path from "path";
@JsonController("/members")
export class MobileMemberController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
    /**
     * @swagger
     * /mobile/members/register:
     *   post:
     *     summary: Register a new member
     *     tags: [Mobile Member]
     */
    @Post("/register")
    @HttpCode(StatusCodes.CREATED)
  async register(@Req() req: any, @Body() data: CreateMemberDto, @Res() res: any) {
    try {
      // Check if mobile already exists
      const existing = await this.memberRepo.findOneBy({ mobileNumber: data.mobileNumber, isDeleted: false });
      if (existing) throw new BadRequestError("Mobile number already registered");

      const member = new Member();
      Object.assign(member, data);

      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);

      member.isDeleted = false;
      member.status = MemberStatus.ACTIVE; // Or PENDING if you have an approval flow

      // Handle File Uploads
      if (req.files) {
        if (req.files.profilePhoto) {
          const file = req.files.profilePhoto;
          const fileName = `profile-${Date.now()}${path.extname(file.name)}`;
          await imageService.fileUpload(file, "members/profile", fileName);
          member.profilePhoto = `members/profile/${fileName}`;
        }

        const handleMultipleFiles = async (field: string, folder: string) => {
          if (req.files[field]) {
            const files = Array.isArray(req.files[field]) ? req.files[field] : [req.files[field]];
            const paths: string[] = [];
            for (const file of files) {
              const fileName = `${field}-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.name)}`;
              await imageService.fileUpload(file, `members/${folder}`, fileName);
              paths.push(`members/${folder}/${fileName}`);
            }
            return paths;
          }
          return [];
        };

        member.workImages = await handleMultipleFiles("workImages", "work-images");
        member.certifications = await handleMultipleFiles("certifications", "certifications");
        member.businessDocuments = await handleMultipleFiles("businessDocuments", "documents");
      }

      const saved = await this.memberRepo.save(member);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Registration successful",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

    /**
     * @swagger
     * /mobile/members/profile:
     *   get:
     *     summary: Get own profile details
     *     tags: [Mobile Member]
     */
    @Get("/profile")
    @UseBefore(AuthMiddleware)
    async getProfile(@Req() req: any, @Res() res: any) {
      try {
        const userId = req.user.userId;
        const member = await this.memberRepo.findOne({
          where: { _id: new ObjectId(userId), isDeleted: false }
        });

        if (!member) throw new NotFoundError("Profile not found");

        return res.status(StatusCodes.OK).json({
          success: true,
          data: member
        });
      } catch (error: any) {
        return handleErrorResponse(error, res);
      }
    }

    /**
     * @swagger
     * /mobile/members/profile:
     *   put:
     *     summary: Update own profile
     *     tags: [Mobile Member]
     */
    @Put("/profile")
    @UseBefore(AuthMiddleware)
    async updateProfile(@Req() req: any, @Body() data: UpdateProfileDto, @Res() res: any) {
      try {
        const userId = req.user.userId;
        const member = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
        if (!member) throw new NotFoundError("Profile not found");

        Object.assign(member, data);

        // Handle Profile Photo Upload
        if (req.files && req.files.profilePhoto) {
          const file = req.files.profilePhoto;
          const fileName = `profile-${Date.now()}${path.extname(file.name)}`;
          await imageService.fileUpload(file, "members/profile", fileName, member.profilePhoto?.split("/").pop());
          member.profilePhoto = `members/profile/${fileName}`;
        }

        const saved = await this.memberRepo.save(member);
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Profile updated successfully",
          data: saved
        });
      } catch (error: any) {
        return handleErrorResponse(error, res);
      }
    }

    /**
     * @swagger
     * /mobile/members:
     *   get:
     *     summary: Get member directory
     *     tags: [Mobile Member]
     */
    @Get("/")
    async getDirectory(
        @QueryParam("page") page: number,
        @QueryParam("limit") limit: number,
        @QueryParam("search") search: string,
        @QueryParam("city") city: string,
        @QueryParam("category") category: string,
        @Res() res: any
    ) {
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      try {
        const where: any = {
          isDeleted: false,
          status: MemberStatus.ACTIVE
        };

        if (search) {
          where.$or = [
            { fullName: { $regex: search, $options: "i" } },
            { businessName: { $regex: search, $options: "i" } },
            { city: { $regex: search, $options: "i" } }
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
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto,
          businessName: m.businessName,
          city: m.city,
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
     * /mobile/members/{id}:
     *   get:
     *     summary: Get details of another member
     *     tags: [Mobile Member]
     */
    @Get("/:id")
    async getMemberDetail(@Param("id") id: string, @Res() res: any) {
      try {
        if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

        const member = await this.memberRepo.findOne({
          where: { _id: new ObjectId(id), isDeleted: false, status: MemberStatus.ACTIVE }
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
}
