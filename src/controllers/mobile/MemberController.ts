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
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import bcrypt from "bcryptjs";
import { UserToken } from "../../entity/UserToken";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { PostModel, PostType } from "../../entity/Post";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Milestone } from "../../entity/Milestone";

@JsonController("/members")
export class MobileMemberController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private postRepo = AppDataSource.getMongoRepository(PostModel);
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private tySlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private milestoneRepo = AppDataSource.getMongoRepository(Milestone);
  /**
   * @swagger
   * /mobile-api/members/register:
   *   post:
   *     summary: Register a new member
   *     tags: [Mobile Member]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateMemberDto'
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

      member.pin = await bcrypt.hash(pin, 10);
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

      const isMatch = await bcrypt.compare(pin, member.pin);
      if (!isMatch) {
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
   *     security:
   *       - bearerAuth: []
   */
  @Get("/profile")
  @UseBefore(MobileAuthMiddleware)
  async getProfile(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const member = await this.memberRepo.findOne({
        where: { _id: new ObjectId(userId), isDeleted: false }
      });

      if (!member) throw new NotFoundError("Profile not found");

      const counts = await this.getMemberCounts(userId);
      const contributionSummary = await this.getContributionSummary(userId);

      const data: any = { ...member };
      delete data.pin;
      delete data.fcmToken;

      if (member.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: member.businessCategory });
        data.businessCategory = cat ? { _id: cat._id, name: cat.name } : member.businessCategory;
      }
      if (member.subCategory) {
        const subCat = await this.categoryRepo.findOneBy({ _id: member.subCategory });
        data.subCategory = subCat ? { _id: subCat._id, name: subCat.name } : member.subCategory;
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...data,
          ...counts,
          contributionSummary
        }
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
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateProfileDto'
   */
  @Put("/profile")
  @UseBefore(MobileAuthMiddleware)
  async updateProfile(@Req() req: any, @Body() data: UpdateProfileDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
      if (!member) throw new NotFoundError("Profile not found");

      Object.assign(member, data);

      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);

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
   * /mobile-api/members/suggestions:
   *   get:
   *     summary: Get member suggestions based on category referral mapping
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/suggestions")
  @UseBefore(MobileAuthMiddleware)
  async getSuggestions(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const member: any = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
      if (!member) throw new NotFoundError("Profile not found");
      const categoryId = member.subCategory;
      if (!ObjectId.isValid(categoryId)) throw new BadRequestError("Invalid Category ID");

      // 1. Find the source category to get its referralParent
      const sourceCategory = await this.categoryRepo.findOneBy({ _id: new ObjectId(categoryId) });
      if (!sourceCategory) throw new NotFoundError("Category not found");

      const refParentId = sourceCategory.referralParent;
      if (!refParentId) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: [],
          message: "No referral mappings found for this category"
        });
      }

      // 2. Find all categories that share the same referralParent (siblings)
      const relatedCategories = await this.categoryRepo.find({
        where: { referralParent: refParentId, isDeleted: false }
      });

      const relatedCategoryIds = relatedCategories.map(c => c._id);

      // Also include the referralParent itself in the filter
      relatedCategoryIds.push(refParentId);

      // 3. Find members with whom the current user already has a connection
      const existingConnections = await this.connectionRepo.find({
        where: {
          $or: [
            { senderId: new ObjectId(userId) },
            { receiverId: new ObjectId(userId) }
          ]
        } as any
      });

      const connectedMemberIds = existingConnections.map(c =>
        c.senderId.toString() === userId ? c.receiverId : c.senderId
      );

      // 4. Find members belonging to any of these related categories (excluding self and connected members)
      const members = await this.memberRepo.find({
        where: {
          _id: { $nin: [new ObjectId(userId), ...connectedMemberIds] },
          $or: [
            { businessCategory: { $in: relatedCategoryIds } },
            { subCategory: { $in: relatedCategoryIds } }
          ],
          isDeleted: false,
          status: MemberStatus.ACTIVE
        } as any,
        take: 15,
        order: { createdAt: "DESC" }
      });

      // 4. Populate category names for the response
      const allCategoryIds = [...new Set(members.flatMap(m => [m.businessCategory, m.subCategory]).filter((id): id is ObjectId => !!id))];
      const categories = allCategoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: allCategoryIds } } as any })
        : [];
      const catMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const data = members.map(m => ({
        _id: m._id,
        name: m.fullName,
        profile: m.profilePhoto,
        businessName: m.businessName,
        city: m.city,
        category: m.businessCategory ? { _id: m.businessCategory, name: catMap.get(m.businessCategory.toString()) } : null,
        sub_category: m.subCategory ? { _id: m.subCategory, name: catMap.get(m.subCategory.toString()) } : null,
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
  /**
   * @swagger
   * /mobile-api/members/follow-back-suggestions:
   *   get:
   *     summary: Get members who follow you but you don't follow back
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/follow-back-suggestions")
  @UseBefore(MobileAuthMiddleware)
  async getFollowBackSuggestions(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;

      // 1. Find all people who follow me
      const myFollowers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
      });

      if (myFollowers.length === 0) {
        return res.status(StatusCodes.OK).json({ success: true, data: [] });
      }

      const followerIds = myFollowers.map(f => f.senderId);

      // 2. Find people I already follow or have requested to follow
      const myOutgoingRequests = await this.connectionRepo.find({
        where: {
          senderId: new ObjectId(userId),
          status: { $in: [ConnectionStatus.ACCEPTED, ConnectionStatus.PENDING] }
        } as any
      });

      const followingIdsStrings = new Set(myOutgoingRequests.map(f => f.receiverId.toString()));

      // 3. Filter followers who I am NOT already following or haven't requested yet
      const followBackIds = followerIds.filter(id => !followingIdsStrings.has(id.toString()));

      if (followBackIds.length === 0) {
        return res.status(StatusCodes.OK).json({ success: true, data: [] });
      }

      // 4. Fetch member details
      const members = await this.memberRepo.find({
        where: {
          _id: { $in: followBackIds },
          isDeleted: false,
          status: MemberStatus.ACTIVE
        } as any
      });

      // Populate Categories for display
      const allCategoryIds = [...new Set(members.flatMap(m => [m.businessCategory, m.subCategory]).filter((id): id is ObjectId => !!id))];
      const categories = allCategoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: allCategoryIds } } as any })
        : [];
      const catMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const data = members.map(m => ({
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        city: m.city,
        category: m.businessCategory ? { _id: m.businessCategory, name: catMap.get(m.businessCategory.toString()) } : null,
        subCategory: m.subCategory ? { _id: m.subCategory, name: catMap.get(m.subCategory.toString()) } : null,
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        data
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
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: city
   *         schema:
   *           type: string
   *       - in: query
   *         name: category
   *         schema:
   *           type: string
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
   *     summary: Get comprehensive profile details of another member
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Member profile details retrieved successfully
   */
  @Get("/:id")
  @UseBefore(MobileAuthMiddleware)
  async getMemberDetail(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const currentUserId = req.user.userId;

      const member = await this.memberRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false, status: MemberStatus.ACTIVE }
      });

      if (!member) throw new NotFoundError("Member not found");

      // Populate Categories
      const populated: any = { ...member };
      delete populated.pin;
      delete populated.fcmToken;
      if (member.businessCategory) {
        const cat = await this.categoryRepo.findOneBy({ _id: member.businessCategory });
        populated.businessCategory = cat ? { _id: cat._id, name: cat.name } : null;
      }
      if (member.subCategory) {
        const subCat = await this.categoryRepo.findOneBy({ _id: member.subCategory });
        populated.subCategory = subCat ? { _id: subCat._id, name: subCat.name } : null;
      }

      // Add Connection Status if authenticated
      if (currentUserId && currentUserId !== id) {
        const myRequest = await this.connectionRepo.findOne({
          where: { senderId: new ObjectId(currentUserId), receiverId: new ObjectId(id) }
        });
        const theirRequest = await this.connectionRepo.findOne({
          where: { senderId: new ObjectId(id), receiverId: new ObjectId(currentUserId) }
        });

        populated.connection = {
          myRequestStatus: myRequest?.status || null,
          theirRequestStatus: theirRequest?.status || null,
          isFollowing: myRequest?.status === ConnectionStatus.ACCEPTED,
          isFollower: theirRequest?.status === ConnectionStatus.ACCEPTED,
          isMutual: myRequest?.status === ConnectionStatus.ACCEPTED && theirRequest?.status === ConnectionStatus.ACCEPTED
        };
      }

      // Fetch Stats & Summary
      const counts = await this.getMemberCounts(id);
      const contributionSummary = await this.getContributionSummary(id);

      // Fetch categorized posts
      const [promotionPosts, requirementPosts, givePosts, askPosts] = await Promise.all([
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.PROMOTION, isDeleted: false },
          take: 5,
          order: { createdAt: "DESC" }
        }),
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.REQUIREMENT, isDeleted: false },
          take: 5,
          order: { createdAt: "DESC" }
        }),
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.GIVE, isDeleted: false },
          take: 5,
          order: { createdAt: "DESC" }
        }),
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.ASK, isDeleted: false },
          take: 5,
          order: { createdAt: "DESC" }
        })
      ]);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...populated,
          ...counts,
          contributionSummary,
          posts: {
            promotion: promotionPosts || [],
            requirement: requirementPosts || [],
            give: givePosts || [],
            ask: askPosts || []
          },
          productsServices: member.productsServices || []
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private async getContributionSummary(memberId: string) {
    const id = new ObjectId(memberId);
    const [
      oneToOnesCount,
      referralsGiven,
      referralsReceived,
      tySlipsGiven,
      tySlipsReceived,
      responsedData
    ] = await Promise.all([
      this.oneToOneRepo.count({ $or: [{ senderId: id }, { receiverId: id }] } as any),
      this.referralRepo.countBy({ senderId: id }),
      this.referralRepo.countBy({ receiverId: id }),
      this.tySlipRepo.find({ where: { senderId: id } }),
      this.tySlipRepo.find({ where: { receiverId: id } }),
      this.postRepo.find({ memberId: id, isDeleted: false })
    ]);

    const tySlipsGivenAmount = tySlipsGiven.reduce((sum, slip) => sum + (slip.amount || 0), 0);
    const tySlipsReceivedAmount = tySlipsReceived.reduce((sum, slip) => sum + (slip.amount || 0), 0);
    const responsesCount = responsedData.reduce((sum, post) => sum + (post.responsedCount || 0), 0);
    const milestoneData = await this.milestoneRepo.find({ where: { memberId: id, isDeleted: false } });
    const milestoneViewsCount = milestoneData.reduce((sum, m) => sum + (m.viewCount || 0), 0);

    return {
      oneToOnesCount,
      referralsGivenCount: referralsGiven,
      referralsReceivedCount: referralsReceived,
      thankYouSlipsGivenAmount: tySlipsGivenAmount,
      thankYouSlipsReceivedAmount: tySlipsReceivedAmount,
      responsesCount,
      milestoneViewsCount
    };
  }

  private async getMemberCounts(memberId: string) {
    const id = new ObjectId(memberId);
    const [followersCount, followingsCount, postsCount] = await Promise.all([
      this.connectionRepo.countBy({ receiverId: id, status: ConnectionStatus.ACCEPTED }),
      this.connectionRepo.countBy({ senderId: id, status: ConnectionStatus.ACCEPTED }),
      this.postRepo.countBy({ memberId: id, isDeleted: false })
    ]);

    return {
      followersCount,
      followingsCount,
      postsCount
    };
  }
}
