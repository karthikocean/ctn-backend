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
import { CreateMemberDto, UpdateProfileDto, SetPinDto } from "../../dto/mobile/Member.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import jwt from "jsonwebtoken";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { UserToken } from "../../entity/UserToken";
@JsonController("/members")
export class MobileMemberController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  /**
   * @swagger
   * /mobile-api/members/register:
   *   post:
   *     summary: Register a new member
   *     tags: [Mobile Member]
   */
  @Post("/register")
  @HttpCode(StatusCodes.CREATED)
  async register(@Req() req: any, @Body() data: CreateMemberDto, @Res() res: any) {
    try {
      // Check if mobile already exists
      const existingMobile = await this.memberRepo.findOneBy({ mobileNumber: data.mobileNumber, isDeleted: false });
      if (existingMobile) throw new BadRequestError("Mobile number already registered");

      // Check if email already exists
      if (data.email) {
        const existingEmail = await this.memberRepo.findOneBy({ email: data.email, isDeleted: false });
        if (existingEmail) throw new BadRequestError("Email already registered");
      }

      // Check GST number limit (max 2 users per GST)
      if (data.gstNumber) {
        const gstCount = await this.memberRepo.countBy({ gstNumber: data.gstNumber, isDeleted: false });
        if (gstCount >= 2) throw new BadRequestError("GST number is already registered with maximum allowed members (2)");
      }

      const member = new Member();
      Object.assign(member, data);

      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);

      member.isDeleted = false;
      member.status = MemberStatus.ACTIVE; // Or PENDING if you have an approval flow

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
   * /mobile-api/members/set-pin:
   *   post:
   *     summary: Set or update member security pin
   *     tags: [Mobile Member]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               userId:
   *                 type: string
   *                 example: "60d5ecb8b392d7001f8e8e3a"
   *               pin:
   *                 type: string
   *                 example: "1234"
   *     responses:
   *       200:
   *         description: PIN updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 accessToken:
   *                   type: string
   *                 data:
   *                   type: object
   *                   properties:
   *                     _id:
   *                       type: string
   *                     fullName:
   *                       type: string
   *                     mobileNumber:
   *                       type: string
   */
  @Post("/set-pin")
  @HttpCode(StatusCodes.OK)
  async setPin(@Body() data: SetPinDto, @Res() res: any) {
    try {
      const { userId, pin } = data;
      if (!ObjectId.isValid(userId)) throw new BadRequestError("Invalid user ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });

      if (!member) throw new NotFoundError("Member not found");

      member.pin = pin;
      await this.memberRepo.save(member);

      // Generate or reuse Token
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const existingToken = await tokenRepo.findOne({
        where: { userId: member._id }
      });

      let token: string;
      if (existingToken) {
        token = existingToken.token;
      } else {
        token = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          process.env.JWT_SECRET as string,
          { expiresIn: "30d" }
        );

        const userToken = new UserToken();
        userToken.userId = member._id;
        userToken.token = token;
        await tokenRepo.save(userToken);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "PIN updated successfully",
        accessToken: token,
        data: {
          _id: member._id,
          fullName: member.fullName,
          mobileNumber: member.mobileNumber
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/members/verify-pin:
   *   post:
   *     summary: Verify member security pin and login
   *     tags: [Mobile Member]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/SetPinDto'
   *     responses:
   *       200:
   *         description: PIN verified successfully
   */
  @Post("/verify-pin")
  @HttpCode(StatusCodes.OK)
  async verifyPin(@Body() data: SetPinDto, @Res() res: any) {
    try {
      const { userId, pin } = data;
      if (!ObjectId.isValid(userId)) throw new BadRequestError("Invalid user ID");

      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });

      if (!member) throw new NotFoundError("Member not found");

      if (member.pin !== pin) {
        throw new BadRequestError("Invalid PIN");
      }

      // Generate or reuse Token
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const existingToken = await tokenRepo.findOne({
        where: { userId: member._id }
      });

      let token: string;
      if (existingToken) {
        token = existingToken.token;
      } else {
        token = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          process.env.JWT_SECRET as string,
          { expiresIn: "30d" }
        );

        const userToken = new UserToken();
        userToken.userId = member._id;
        userToken.token = token;
        await tokenRepo.save(userToken);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Login successful",
        accessToken: token,
        data: {
          _id: member._id,
          fullName: member.fullName,
          mobileNumber: member.mobileNumber,
          email: member.email
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/members/profile:
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
   * /mobile-api/members/profile:
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
   * /mobile-api/members:
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
   * /mobile-api/members/{id}:
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
