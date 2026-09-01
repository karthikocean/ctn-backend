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
import { Member, MemberStatus, LocationVisibility } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { CreateMemberDto, UpdateProfileDto, SetPinDto, UpdateLocationDto, CheckLocationDto, UpdateFcmTokenDto } from "../../dto/mobile/Member.dto";
import { BusinessRegion, Area } from "../../entity/BusinessRegion";
import { State } from "../../entity/State";
import { City } from "../../entity/City";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import jwt from "jsonwebtoken";
import handleErrorResponse from "../../utils/commonFunction";
import imageService from "../../utils/upload";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import bcrypt from "bcryptjs";
import { UserToken } from "../../entity/UserToken";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { PostModel, PostType } from "../../entity/Post";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Milestone } from "../../entity/Milestone";
import { SubscriptionService } from "../../services/subscription.service";
import { PointHistory } from "../../entity/PointHistory";
import { PostReport } from "../../entity/PostReport";
import { Conversation } from "../../entity/Conversation";
import { ReportedHistory } from "../../entity/ReportedHistory";
import { ReferralService } from "../../services/referral.service";

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
  private businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);
  private postReportRepo = AppDataSource.getMongoRepository(PostReport);
  private conversationRepo = AppDataSource.getMongoRepository(Conversation);
  private referralService = new ReferralService();
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
        const gstCount = await this.memberRepo.count({ gstNumber: data.gstNumber, isDeleted: false });
        if (gstCount >= 2) throw new BadRequestError("GST number is already registered with maximum allowed members (2)");
      }

      // Validate referral code if provided
      let referrerMember: Member | null = null;
      if (data.referralCode && data.referralCode.trim()) {
        referrerMember = await this.referralService.validateReferralCode(
          data.referralCode,
          undefined,
          data.email,
          data.mobileNumber
        );
      }

      const member = new Member();
      Object.assign(member, data);

      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);
      if (data.businessRegion && ObjectId.isValid(data.businessRegion)) {
        member.businessRegion = new ObjectId(data.businessRegion);
      } else {
        member.businessRegion = null;
      }

      member.isDeleted = false;
      member.points = 0;
      member.dailyScore = 0;
      member.dob = data.dob ? parseDob(data.dob) : undefined;
      member.status = MemberStatus.ACTIVE; // Or PENDING if you have an approval flow
      member.lastLoggedIn = new Date();
      member.referralCode = await this.referralService.generateUniqueReferralCode("Trusted Network");
      // if (referrerMember) {
      //   member.referredBy = referrerMember._id;
      // }

      const saved = await this.memberRepo.save(member);

      // Process referral rewards if a valid referral code was supplied
      if (referrerMember && data.referralCode) {
        try {
          await this.referralService.processReferral({
            referredMember: saved,
            referralCode: data.referralCode
          });
        } catch (referralErr: any) {
          console.error(`[MemberRegistration] Referral processing notice for member ${saved._id}:`, referralErr.message);
        }
      }

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
      member.lastLoggedIn = new Date();
      await this.memberRepo.save(member);

      const token = await this.getOrRefreshMemberToken(member);

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
      if (!member.pin) throw new BadRequestError("PIN not configured. Please set your PIN to proceed.");
      const isMatch = await bcrypt.compare(pin, member.pin);
      if (!isMatch) {
        throw new BadRequestError("Invalid PIN");
      }

      member.lastLoggedIn = new Date();
      if (member.status === MemberStatus.INACTIVE) {
        member.status = MemberStatus.ACTIVE;
      }
      await this.memberRepo.save(member);

      const token = await this.getOrRefreshMemberToken(member);

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

  private async getOrRefreshMemberToken(member: Member): Promise<string> {
    const tokenRepo = AppDataSource.getMongoRepository(UserToken);
    const jwtSecret = process.env.JWT_SECRET as string;
    const jwtExpiresIn = (process.env.JWT_EXPIRES_IN || "30d") as any;

    const existingToken = await tokenRepo.findOne({
      where: { userId: member._id }
    });

    if (existingToken) {
      try {
        jwt.verify(existingToken.token, jwtSecret);
        return existingToken.token;
      } catch (error: any) {
        console.log(error);
        const token = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          jwtSecret,
          { expiresIn: jwtExpiresIn }
        );

        existingToken.token = token;
        await tokenRepo.save(existingToken);
        return token;
      }
    }

    const token = jwt.sign(
      {
        userId: member._id.toString(),
        userType: "MEMBER"
      },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    const userToken = new UserToken();
    userToken.userId = member._id;
    userToken.token = token;
    await tokenRepo.save(userToken);
    return token;
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
        data.businessRegion = matchedArea ? { _id: matchedArea._id, name: matchedArea.name } : member.businessRegion;
      }

      const subService = new SubscriptionService();
      const subscription = await subService.getActiveSubscription(userId);

      const totalDays = (subscription as any).totalDays ?? (
        subscription.startDate && subscription.endDate
          ? Math.max(1, Math.round((new Date(subscription.endDate).getTime() - new Date(subscription.startDate).getTime()) / (1000 * 60 * 60 * 24)))
          : 0
      );

      const totalTrialDays = (subscription as any).totalTrialDays ?? (subscription.isTrial ? totalDays : 0);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...data,
          ...counts,
          contributionSummary,
          totalDays,
          totalTrialDays,
          subscription: {
            planId: subscription.planId,
            planName: subscription.planName,
            type: subscription.type,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            daysRemaining: subscription.daysRemaining,
            totalDays,
            totalTrialDays,
            isTrial: subscription.isTrial || false,
            isPaidUser: subscription.status === "ACTIVE" && !subscription.isTrial
          }
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

      const oldProfilePhoto = member.profilePhoto;
      const oldProfileBanner = member.profileBanner;
      const oldWorkImages = member.workImages;
      const oldCertifications = member.certifications;
      const oldBusinessDocuments = member.businessDocuments;

      Object.assign(member, data);
      console.log(JSON.stringify(data), "data");
      if (data.businessCategory) member.businessCategory = new ObjectId(data.businessCategory);
      if (data.subCategory) member.subCategory = new ObjectId(data.subCategory);
      if (data.businessRegion) {
        if (ObjectId.isValid(data.businessRegion)) {
          member.businessRegion = new ObjectId(data.businessRegion);
        } else {
          member.businessRegion = null;
        }
      }
      if (data.dob) {
        member.dob = parseDob(data.dob);
      }
      const saved = await this.memberRepo.save(member);

      // Clean up replaced S3 files
      if (data.profilePhoto !== undefined) {
        imageService.cleanupReplacedFiles(oldProfilePhoto, data.profilePhoto);
      }
      if (data.profileBanner !== undefined) {
        imageService.cleanupReplacedFiles(oldProfileBanner, data.profileBanner);
      }
      if (data.workImages !== undefined) {
        imageService.cleanupReplacedFiles(oldWorkImages, data.workImages);
      }
      if (data.certifications !== undefined) {
        imageService.cleanupReplacedFiles(oldCertifications, data.certifications);
      }
      if (data.businessDocuments !== undefined) {
        imageService.cleanupReplacedFiles(oldBusinessDocuments, data.businessDocuments);
      }

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
   * /mobile-api/members/profile:
   *   delete:
   *     summary: Soft delete own member account / profile
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Member deleted successfully
   */
  @Delete("/profile")
  @UseBefore(MobileAuthMiddleware)
  async deleteProfile(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const member = await this.memberRepo.findOneBy({
        _id: new ObjectId(userId),
        isDeleted: false
      });

      if (!member) {
        throw new NotFoundError("Profile not found");
      }

      member.isDeleted = true;
      member.status = MemberStatus.INACTIVE;
      member.fcmToken = undefined;
      await this.memberRepo.save(member);

      // Invalidate active user tokens / sessions
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      await tokenRepo.deleteMany({ userId: new ObjectId(userId) } as any);

      // Permanently delete all connections for this member
      await this.connectionRepo.deleteMany({
        $or: [
          { senderId: new ObjectId(userId) },
          { receiverId: new ObjectId(userId) }
        ]
      } as any);

      // Clean up member S3 media files
      const memberMediaFiles = [
        member.profilePhoto,
        member.profileBanner,
        ...(member.workImages || []),
        ...(member.certifications || []),
        ...(member.businessDocuments || []),
        ...(member.productsServices || []).map((p) => p.image)
      ].filter(Boolean);
      await imageService.cleanupFiles(memberMediaFiles);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Profile deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/members/location:
   *   put:
   *     summary: Update location and visibility settings
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateLocationDto'
   */
  @Put("/location")
  @UseBefore(MobileAuthMiddleware)
  async updateLocation(@Req() req: any, @Body() data: UpdateLocationDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      member.latitude = Number(data.latitude);
      member.longitude = Number(data.longitude);
      member.locationVisibility = data.locationVisibility;

      const saved = await this.memberRepo.save(member);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Location updated successfully",
        data: {
          latitude: saved.latitude,
          longitude: saved.longitude,
          locationVisibility: saved.locationVisibility
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/members/fcm-token:
   *   put:
   *     summary: Update member FCM token for push notifications
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fcmToken
   *             properties:
   *               fcmToken:
   *                 type: string
   *                 example: "fcm_token_here"
   *     responses:
   *       200:
   *         description: FCM Token updated successfully
   */
  @Put("/fcm-token")
  @UseBefore(MobileAuthMiddleware)
  async updateFcmToken(@Req() req: any, @Body() data: UpdateFcmTokenDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const member = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
      if (!member) throw new NotFoundError("Member not found");

      member.fcmToken = data.fcmToken;
      await this.memberRepo.save(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "FCM token updated successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/members/check-location:
   *   post:
   *     summary: Check if current coordinates match the saved profile location coordinates
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CheckLocationDto'
   */
  @Post("/check-location")
  @UseBefore(MobileAuthMiddleware)
  async checkLocation(@Req() req: any, @Body() data: CheckLocationDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const currentUser = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
      if (!currentUser) throw new NotFoundError("Member not found");

      if (
        currentUser.latitude === undefined ||
        currentUser.longitude === undefined ||
        currentUser.latitude === null ||
        currentUser.longitude === null
      ) {
        throw new BadRequestError("Need to update current location");
      }

      // Check if coordinate is equal to saved coordinate (within 10m / 0.0001 degrees tolerance)
      const latDiff = Math.abs(data.latitude - currentUser.latitude);
      const lngDiff = Math.abs(data.longitude - currentUser.longitude);

      if (latDiff > 0.0001 || lngDiff > 0.0001) {
        throw new BadRequestError("Need to update current location");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Location matches"
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
          ],
          isDeleted: false
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
        businessType: m.businessType,
        legalName: m.legalName,
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
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });

      if (myFollowers.length === 0) {
        return res.status(StatusCodes.OK).json({ success: true, data: [] });
      }

      const followerIds = myFollowers.map(f => f.senderId);

      // 2. Find people I already follow or have requested to follow
      const myOutgoingRequests = await this.connectionRepo.find({
        where: {
          senderId: new ObjectId(userId),
          status: { $in: [ConnectionStatus.ACCEPTED, ConnectionStatus.PENDING] },
          isDeleted: false
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
        businessType: m.businessType,
        legalName: m.legalName,
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
   *     security:
   *       - bearerAuth: []
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
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *       - in: query
   *         name: region
   *         schema:
   *           type: string
   */
  @Get("/")
  @UseBefore(MobileAuthMiddleware)
  async getDirectory(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("city") city: string,
    @QueryParam("category") category: string,
    @QueryParam("state") state: string,
    @QueryParam("region") region: string,
    @Res() res: any
  ) {
    const userId = req.user.userId;
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = {
        _id: { $ne: new ObjectId(userId) },
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
      if (state) where.state = state;
      if (region && ObjectId.isValid(region)) where.businessRegion = new ObjectId(region);

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

      const areasMap = await this.getAreasMap(members);

      // Fetch outgoing and incoming connections to map relationship status
      const memberIds = members.map(m => m._id);
      const userOids = [new ObjectId(userId), userId.toString()];
      const memberTargetIds = [
        ...memberIds.map(id => new ObjectId(id)),
        ...memberIds.map(id => id.toString())
      ];

      const outgoingConnections = memberIds.length > 0
        ? await this.connectionRepo.find({
          where: {
            senderId: { $in: userOids },
            receiverId: { $in: memberTargetIds },
            isDeleted: { $ne: true }
          } as any
        })
        : [];
      const outgoingMap = new Map(outgoingConnections.map(c => [c.receiverId.toString(), c]));

      const incomingConnections = memberIds.length > 0
        ? await this.connectionRepo.find({
          where: {
            receiverId: { $in: userOids },
            senderId: { $in: memberTargetIds },
            isDeleted: { $ne: true }
          } as any
        })
        : [];
      const incomingMap = new Map(incomingConnections.map(c => [c.senderId.toString(), c]));

      console.log(`[getDirectory] Logged-in User: ${userId} | Search: "${search || ""}" | Found Members: ${members.length}`);
      console.log(`[getDirectory] Outgoing Connections (${outgoingConnections.length}):`, outgoingConnections.map(c => ({ senderId: c.senderId?.toString(), receiverId: c.receiverId?.toString(), status: c.status })));
      console.log(`[getDirectory] Incoming Connections (${incomingConnections.length}):`, incomingConnections.map(c => ({ senderId: c.senderId?.toString(), receiverId: c.receiverId?.toString(), status: c.status })));

      const data = members.map(m => {
        const myRequest = outgoingMap.get(m._id.toString());
        const theirRequest = incomingMap.get(m._id.toString());

        return {
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto,
          businessName: m.businessName,
          businessType: m.businessType,
          legalName: m.legalName,
          city: m.city,
          businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null,
          subCategory: m.subCategory ? categoryMap.get(m.subCategory.toString()) : null,
          businessRegion: areasMap.get(m._id.toString()) || null,
          connection: {
            myRequestStatus: myRequest?.status || null,
            theirRequestStatus: theirRequest?.status || null,
            isFollowing: myRequest?.status === ConnectionStatus.ACCEPTED,
            isFollower: theirRequest?.status === ConnectionStatus.ACCEPTED,
            isMutual: myRequest?.status === ConnectionStatus.ACCEPTED && theirRequest?.status === ConnectionStatus.ACCEPTED
          },
          status: myRequest?.status === ConnectionStatus.ACCEPTED && theirRequest?.status === ConnectionStatus.ACCEPTED
            ? "Following"
            : myRequest?.status === ConnectionStatus.ACCEPTED
              ? "Following"
              : theirRequest?.status === ConnectionStatus.ACCEPTED && myRequest?.status === ConnectionStatus.PENDING
                ? "Follow back"
                : theirRequest?.status === ConnectionStatus.PENDING
                  ? "Received"
                  : myRequest?.status === ConnectionStatus.PENDING
                    ? "Requested"
                    : theirRequest?.status === ConnectionStatus.ACCEPTED
                      ? "Follow back"
                      : "Connect"
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/members/nearby:
   *   get:
   *     summary: Get nearby members within a radius (5 km or 10 km) using latitude and longitude
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: lat
   *         schema:
   *           type: number
   *       - in: query
   *         name: lng
   *         schema:
   *           type: number
   *       - in: query
   *         name: radius
   *         schema:
   *           type: number
   *           enum: [5, 10]
   *           default: 10
   *         description: Radius filter in kilometers (5 km or 10 km, defaults to 10 km)
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/nearby")
  @UseBefore(MobileAuthMiddleware)
  async getNearbyMembers(
    @Req() req: any,
    @QueryParam("lat") latParam: number,
    @QueryParam("lng") lngParam: number,
    @QueryParam("radius") radiusParam: number,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    const userId = req.user.userId;
    page = Number(page) || 0;
    limit = Number(limit) || 1000;

    try {
      let lat = Number(latParam);
      let lng = Number(lngParam);

      // Support 5 km and 10 km variants. Default/fallback to 10 km.
      const radius = Number(radiusParam) === 5 ? 5 : 10;

      // If coords are not provided in query, fall back to current user's profile coords
      if (isNaN(lat) || isNaN(lng)) {
        const currentUser = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
        if (!currentUser || currentUser.latitude === undefined || currentUser.longitude === undefined || currentUser.latitude === null || currentUser.longitude === null) {
          throw new BadRequestError("Current GPS coordinates are required to find nearby members. Please provide lat/lng in query or update your location profile.");
        }
        lat = currentUser.latitude;
        lng = currentUser.longitude;
      }

      // Calculate Bounding Box for selected radius (1 degree latitude is ~111km, 1 degree longitude is ~111km * cos(lat))
      const latBound = radius / 111;
      const lonBound = radius / (111 * Math.cos(lat * Math.PI / 180));

      // Query members within the bounding box
      const boundingBoxWhere: any = {
        _id: { $ne: new ObjectId(userId) },
        isDeleted: false,
        status: MemberStatus.ACTIVE,
        latitude: { $gte: lat - latBound, $lte: lat + latBound },
        longitude: { $gte: lng - lonBound, $lte: lng + lonBound }
      };

      const membersInBox = await this.memberRepo.find({
        where: boundingBoxWhere
      });

      // Gather boxMemberIds to fetch connections in bulk
      const boxMemberIds = membersInBox.map(m => m._id);
      const userOids = [new ObjectId(userId), userId.toString()];
      const boxTargetIds = [
        ...boxMemberIds.map(id => new ObjectId(id)),
        ...boxMemberIds.map(id => id.toString())
      ];

      const outgoingConnections = boxMemberIds.length > 0
        ? await this.connectionRepo.find({
          where: {
            senderId: { $in: userOids },
            receiverId: { $in: boxTargetIds },
            isDeleted: { $ne: true }
          } as any
        })
        : [];
      const outgoingMap = new Map(outgoingConnections.map(c => [c.receiverId.toString(), c]));

      const incomingConnections = boxMemberIds.length > 0
        ? await this.connectionRepo.find({
          where: {
            receiverId: { $in: userOids },
            senderId: { $in: boxTargetIds },
            isDeleted: { $ne: true }
          } as any
        })
        : [];
      const incomingMap = new Map(incomingConnections.map(c => [c.senderId.toString(), c]));

      // Exact Haversine distance and locationVisibility filters
      const membersWithDistance = membersInBox
        .map(m => {
          if (m.latitude === undefined || m.longitude === undefined || m.latitude === null || m.longitude === null) return null;
          const dist = this.calculateDistance(lat, lng, m.latitude, m.longitude);

          const myRequest = outgoingMap.get(m._id.toString());
          const theirRequest = incomingMap.get(m._id.toString());

          const isFollowing = myRequest?.status === ConnectionStatus.ACCEPTED;
          const isFollower = theirRequest?.status === ConnectionStatus.ACCEPTED;
          const isMutual = isFollowing && isFollower;

          // Location Visibility Check
          let isVisible = false;
          if (!m.locationVisibility || m.locationVisibility === LocationVisibility.EVERYONE) {
            isVisible = true;
          } else if (m.locationVisibility === LocationVisibility.FOLLOWERS) {
            isVisible = isFollowing;
          } else if (m.locationVisibility === LocationVisibility.MUTUAL) {
            isVisible = isMutual;
          }

          if (!isVisible) return null;

          return {
            ...m,
            distance: Number(dist.toFixed(2)),
            myRequest,
            theirRequest,
            isFollowing,
            isFollower,
            isMutual
          };
        })
        .filter((m): m is any => m !== null && m.distance <= radius);

      // Sort closest first
      membersWithDistance.sort((a, b) => a.distance - b.distance);

      const total = membersWithDistance.length;
      const paginatedMembers = membersWithDistance.slice(page * limit, (page + 1) * limit);

      if (paginatedMembers.length === 0) {
        return pagination(total, [], limit, page, res);
      }

      // Populate Categories & Areas for paginated members
      const categoryIds = paginatedMembers
        .flatMap(m => [m.businessCategory, m.subCategory])
        .filter((id): id is ObjectId => !!id);

      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), { _id: c._id, name: c.name }]));
      const areasMap = await this.getAreasMap(paginatedMembers);

      const data = paginatedMembers.map(m => {
        return {
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto,
          businessName: m.businessName,
          businessType: m.businessType,
          legalName: m.legalName,
          city: m.city,
          distance: m.distance,
          latitude: m.latitude,
          longitude: m.longitude,
          businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null,
          subCategory: m.subCategory ? categoryMap.get(m.subCategory.toString()) : null,
          businessRegion: areasMap.get(m._id.toString()) || null,
          connection: {
            myRequestStatus: m.myRequest?.status || null,
            theirRequestStatus: m.theirRequest?.status || null,
            isFollowing: m.isFollowing,
            isFollower: m.isFollower,
            isMutual: m.isMutual
          },
          status: m.myRequest?.status === ConnectionStatus.ACCEPTED && m.theirRequest?.status === ConnectionStatus.ACCEPTED
            ? "Following"
            : m.myRequest?.status === ConnectionStatus.ACCEPTED
              ? "Following"
              : m.theirRequest?.status === ConnectionStatus.ACCEPTED && m.myRequest?.status === ConnectionStatus.PENDING
                ? "Follow back"
                : m.theirRequest?.status === ConnectionStatus.PENDING
                  ? "Received"
                  : m.myRequest?.status === ConnectionStatus.PENDING
                    ? "Requested"
                    : m.theirRequest?.status === ConnectionStatus.ACCEPTED
                      ? "Follow back"
                      : "Connect"
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  }

  /**
   * @swagger
   * /mobile-api/members/recap-lists:
   *   get:
   *     summary: Get today's registrations and birthdays in user's region, and monthly top performance rankings (if 1st of month)
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: forceMonthly
   *         schema:
   *           type: boolean
   *         description: Force monthly calculations even if it is not the 1st of the month
   */
  @Get("/recap-lists")
  @UseBefore(MobileAuthMiddleware)
  async getRecapLists(
    @Req() req: any,
    @QueryParam("forceMonthly") forceMonthly: boolean,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId;
      const loginUser = await this.memberRepo.findOneBy({ _id: new ObjectId(userId), isDeleted: false });
      if (!loginUser) throw new NotFoundError("Member not found");

      const userRegion = loginUser.businessRegion;

      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      // 1. Fetch Today's Registered Members in Region
      const registeredToday = await this.memberRepo.find({
        where: {
          businessRegion: userRegion,
          isDeleted: false,
          status: MemberStatus.ACTIVE,
          createdAt: {
            $gte: startOfToday,
            $lte: endOfToday
          }
        } as any
      });
      const todayRegisteredFormatted = await this.formatMembersList(registeredToday);

      // 2. Fetch Today's Birthday Members in Region
      const regionMembers = await this.memberRepo.find({
        where: {
          businessRegion: userRegion,
          isDeleted: false,
          status: MemberStatus.ACTIVE,
          dob: { $exists: true, $ne: null }
        } as any
      });
      const todayMonth = today.getMonth() + 1;
      const todayDay = today.getDate();
      const birthdayMembers = regionMembers.filter(m => {
        if (!m.dob) return false;
        const dob = new Date(m.dob);
        return dob.getDate() === todayDay && dob.getMonth() + 1 === todayMonth;
      });
      const todayBirthdaysFormatted = await this.formatMembersList(birthdayMembers);

      // Check if it's within the 1st–7th day of the month or forced
      const showMonthly = today.getDate() <= 7 || forceMonthly === true || String(req.query.forceMonthly) === "true";

      let topThankYouSlips: any[] = [];
      let topReferrals: any[] = [];
      let topRequirementPosts: any[] = [];
      let topOneToOnes: any[] = [];
      let topPoints: any[] = [];

      if (showMonthly) {
        // Last calendar month boundaries
        const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0, 0);
        const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

        // a) Top 3 Business Done
        const tySlipStats = await this.tySlipRepo.aggregate([
          {
            $match: {
              createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
            }
          },
          {
            $group: {
              _id: "$senderId",
              count: { $sum: 1 }
            }
          },
          {
            $match: { count: { $gt: 0 } }
          },
          {
            $sort: { count: -1 }
          },
          {
            $limit: 3
          }
        ]).toArray();

        // b) Top 3 Recommendations
        const referralStats = await this.referralRepo.aggregate([
          {
            $match: {
              createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
            }
          },
          {
            $group: {
              _id: "$senderId",
              count: { $sum: 1 }
            }
          },
          {
            $match: { count: { $gt: 0 } }
          },
          {
            $sort: { count: -1 }
          },
          {
            $limit: 3
          }
        ]).toArray();

        // c) Top 3 Requirement Posts
        const postStats = await this.postRepo.aggregate([
          {
            $match: {
              type: PostType.REQUIREMENT,
              isDeleted: false,
              createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
            }
          },
          {
            $group: {
              _id: "$memberId",
              count: { $sum: 1 }
            }
          },
          {
            $match: { count: { $gt: 0 } }
          },
          {
            $sort: { count: -1 }
          },
          {
            $limit: 3
          }
        ]).toArray();

        // d) Top 3 Direct Meets
        const oneToOneStats = await this.oneToOneRepo.aggregate([
          {
            $match: {
              createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
            }
          },
          {
            $project: {
              participants: ["$senderId", "$receiverId"]
            }
          },
          {
            $unwind: "$participants"
          },
          {
            $group: {
              _id: "$participants",
              count: { $sum: 1 }
            }
          },
          {
            $match: { count: { $gt: 0 } }
          },
          {
            $sort: { count: -1 }
          },
          {
            $limit: 3
          }
        ]).toArray();

        // e) Top 3 Points
        const pointStats = await this.historyRepo.aggregate([
          {
            $match: {
              type: "earned",
              createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
            }
          },
          {
            $group: {
              _id: "$memberId",
              totalPoints: { $sum: "$points" }
            }
          },
          {
            $match: { totalPoints: { $gt: 0 } }
          },
          {
            $sort: { totalPoints: -1 }
          },
          {
            $limit: 3
          }
        ]).toArray();

        // Resolve and format lists
        [
          topThankYouSlips,
          topReferrals,
          topRequirementPosts,
          topOneToOnes,
          topPoints
        ] = await Promise.all([
          this.getRankedMembersList(tySlipStats, "count"),
          this.getRankedMembersList(referralStats, "count"),
          this.getRankedMembersList(postStats, "count"),
          this.getRankedMembersList(oneToOneStats, "count"),
          this.getRankedMembersList(pointStats, "totalPoints")
        ]);
      }

      const mergedList = [
        ...todayRegisteredFormatted.map(item => ({ ...item, type: "REGISTRATION" })),
        ...todayBirthdaysFormatted.map(item => ({ ...item, type: "BIRTHDAY" })),
        ...topThankYouSlips.map(item => ({ ...item, type: "BUSINESS_DONE" })),
        ...topReferrals.map(item => ({ ...item, type: "RECOMMENDATIONS" })),
        ...topRequirementPosts.map(item => ({ ...item, type: "REQUIREMENT" })),
        ...topOneToOnes.map(item => ({ ...item, type: "DIRECT_MEET" })),
        ...topPoints.map(item => ({ ...item, type: "POINTS" }))
      ];

      // Random shuffle using Math.random() (Fisher-Yates shuffle algorithm)
      for (let i = mergedList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mergedList[i], mergedList[j]] = [mergedList[j], mergedList[i]];
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: mergedList
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private async formatMembersList(members: Member[]) {
    if (!members || members.length === 0) return [];

    const categoryIds = [...new Set(
      members.flatMap(m => [m.businessCategory, m.subCategory]).filter((id): id is ObjectId => !!id)
    )];

    const categories = categoryIds.length > 0
      ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
      : [];
    const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

    const regionIds = [...new Set(
      members.map(m => m.businessRegion).filter((id): id is ObjectId => !!id)
    )];
    const regions = regionIds.length > 0
      ? await this.businessRegionRepo.find({
        where: { "areas._id": { $in: regionIds } } as any
      })
      : [];
    const areaMap = new Map<string, string>();
    for (const r of regions) {
      if (r.areas) {
        for (const area of r.areas) {
          areaMap.set(area._id.toString(), area.name);
        }
      }
    }

    return members.map(m => ({
      _id: m._id,
      name: m.fullName,
      fullName: m.fullName,
      profile: m.profilePhoto || null,
      profilePhoto: m.profilePhoto || null,
      businessName: m.businessName || null,
      category: m.businessCategory ? (categoryMap.get(m.businessCategory.toString()) || null) : null,
      subCategory: m.subCategory ? (categoryMap.get(m.subCategory.toString()) || null) : null,
      region: m.businessRegion ? (areaMap.get(m.businessRegion.toString()) || null) : null
    }));
  }

  private async getRankedMembersList(
    stats: { _id: ObjectId; count?: number; totalPoints?: number }[],
    valueKey: "count" | "totalPoints"
  ) {
    if (!stats || stats.length === 0) return [];

    const memberIds = stats.map(s => s._id);
    const members = await this.memberRepo.find({
      where: {
        _id: { $in: memberIds },
        isDeleted: false,
        status: MemberStatus.ACTIVE
      } as any
    });

    const formattedMembers = await this.formatMembersList(members);
    const formattedMap = new Map(formattedMembers.map(m => [m._id.toString(), m]));

    return stats
      .map((s, index) => {
        const formatted = formattedMap.get(s._id.toString());
        if (!formatted) return null;
        return {
          ...formatted,
          order: index + 1,
          rank: index + 1,
          [valueKey]: s[valueKey]
        };
      })
      .filter((m): m is any => m !== null);
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
      this.oneToOneRepo.count({ $or: [{ senderId: id }, { receiverId: id }], status: { $ne: "REPORTED" } } as any),
      this.referralRepo.count({ senderId: id, status: { $ne: "REPORTED" } }),
      this.referralRepo.count({ receiverId: id, status: { $ne: "REPORTED" } }),
      this.tySlipRepo.find({ where: { senderId: id, status: { $ne: "REPORTED" } } }),
      this.tySlipRepo.find({ where: { receiverId: id, status: { $ne: "REPORTED" } } }),
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

    const [followers, followings, postsCount] = await Promise.all([
      this.connectionRepo.find({ where: { receiverId: id, status: ConnectionStatus.ACCEPTED, isDeleted: false } }),
      this.connectionRepo.find({ where: { senderId: id, status: ConnectionStatus.ACCEPTED, isDeleted: false } }),
      this.postRepo.count({ memberId: id, isDeleted: false })
    ]);

    const followerIds = followers.map(f => f.senderId.toString());
    const followingIds = followings.map(f => f.receiverId.toString());

    console.log(`[PROFILE_COUNTS] Member ID: ${memberId}`);
    console.log(`[PROFILE_COUNTS] Followers count: ${followers.length}`);
    console.log("[PROFILE_COUNTS] Follower IDs (senderIds):", followerIds);
    console.log(`[PROFILE_COUNTS] Followings count: ${followings.length}`);
    console.log("[PROFILE_COUNTS] Following IDs (receiverIds):", followingIds);

    return {
      followersCount: followers.length,
      followingsCount: followings.length,
      postsCount
    };
  }

  private async getAreasMap(members: Member[]) {
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

    const areasMap = new Map<string, { _id: ObjectId, name: string } | null>();
    for (const m of members) {
      let areaInfo = null;
      if (m.businessRegion && m.state && m.city) {
        const areasList = regionMap.get(`${m.state.toLowerCase()}|${m.city.toLowerCase()}`) || [];
        const matchedArea = areasList.find(a => a._id?.toString() === m.businessRegion!.toString());
        if (matchedArea) {
          areaInfo = { _id: matchedArea._id, name: matchedArea.name };
        }
      }
      areasMap.set(m._id.toString(), areaInfo);
    }
    return areasMap;
  }

  /**
   * @swagger
   * /mobile-api/members/reported-members:
   *   get:
   *     summary: Get list of members reported or blocked by the logged-in user
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/reported-members")
  @UseBefore(MobileAuthMiddleware)
  async getReportedMembers(
    @Req() req: any,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @Res() res: any
  ) {
    try {
      const myId = new ObjectId(req.user.userId);

      // --- 1. Post reports: reporterId = me, join post to get memberId ---
      const postReportAgg = await this.postReportRepo.aggregate([
        { $match: { reporterId: myId } },
        {
          $lookup: {
            from: "posts",
            localField: "postId",
            foreignField: "_id",
            as: "post"
          }
        },
        { $unwind: { path: "$post", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            reportedMemberId: "$post.memberId",
            reason: 1,
            createdAt: 1
          }
        },
        { $match: { reportedMemberId: { $exists: true, $ne: null } } }
      ]).toArray();

      // --- 2. Chat reports: conversation where I reported (reportedBy = me, status = REPORTED) ---
      // const chatReportAgg = await this.conversationRepo.aggregate([
      //   {
      //     $match: {
      //       reportedBy: myId,
      //       status: "REPORTED"
      //     }
      //   },
      //   {
      //     $project: {
      //       // The other participant is the reported member
      //       reportedMemberId: {
      //         $arrayElemAt: [
      //           {
      //             $filter: {
      //               input: "$participants",
      //               as: "p",
      //               cond: { $ne: ["$$p", myId] }
      //             }
      //           },
      //           0
      //         ]
      //       },
      //       reason: "$reportReason",
      //       createdAt: 1
      //     }
      //   },
      //   { $match: { reportedMemberId: { $exists: true, $ne: null } } }
      // ]).toArray();

      // --- 3. Profile reports: reported_history where reporterUserId = me ---
      const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
      const historyReportAgg = await reportedHistoryRepo.find({
        where: { reporterUserId: myId } as any
      });

      // --- 4. Merge, deduplicate keeping all types, sort by createdAt desc ---
      const allEntries: { reportedMemberId: ObjectId; type: string; reason?: string; createdAt: Date }[] = [
        ...postReportAgg.map(r => ({
          reportedMemberId: r.reportedMemberId,
          type: "POST_REPORT",
          reason: r.reason,
          createdAt: r.createdAt
        })),
        // ...chatReportAgg.map(r => ({
        //   reportedMemberId: r.reportedMemberId,
        //   type: "CHAT_REPORT",
        //   reason: r.reason,
        //   createdAt: r.createdAt
        // })),
        ...historyReportAgg.map(r => ({
          reportedMemberId: r.targetUserId,
          type: "CHAT_REPORT",
          reason: r.reason,
          createdAt: r.createdAt
        }))
      ];

      // Sort by createdAt descending
      allEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const total = allEntries.length;
      const hasLimit = limitParam !== undefined && limitParam !== null && Number(limitParam) > 0;
      const limit = hasLimit ? Number(limitParam) : (total > 0 ? total : 1);
      const page = hasLimit ? Math.max(0, Number(pageParam) || 0) : 0;
      const skip = page * limit;

      const paginated = hasLimit ? allEntries.slice(skip, skip + limit) : allEntries;

      if (paginated.length === 0) {
        return pagination(total, [], limit, page, res);
      }

      // --- 4. Bulk fetch member details ---
      const memberIds = [...new Set(paginated.map(e => e.reportedMemberId.toString()))].map(id => new ObjectId(id));
      const members = await this.memberRepo.find({
        where: { _id: { $in: memberIds }, isDeleted: false } as any
      });

      // --- 5. Resolve category and region names in bulk ---
      const formatted = await this.formatMembersList(members);
      const formattedMap = new Map(formatted.map(f => [f._id.toString(), f]));

      // --- 6. Build final response ---
      const results = paginated.map(entry => {
        const memberId = entry.reportedMemberId.toString();
        const memberData = formattedMap.get(memberId);
        if (!memberData) return null;
        return {
          ...memberData,
          type: entry.type,
          reason: entry.reason ?? null,
          reportedAt: entry.createdAt
        };
      }).filter(Boolean);

      return pagination(total, results, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
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
      } else {
        populated.businessRegion = null;
      }

      // Add Connection Status if authenticated
      if (currentUserId && currentUserId !== id) {
        const myRequest = await this.connectionRepo.findOne({
          where: {
            senderId: { $in: [new ObjectId(currentUserId), currentUserId.toString()] },
            receiverId: { $in: [new ObjectId(id), id.toString()] },
            isDeleted: { $ne: true }
          } as any
        });
        const theirRequest = await this.connectionRepo.findOne({
          where: {
            senderId: { $in: [new ObjectId(id), id.toString()] },
            receiverId: { $in: [new ObjectId(currentUserId), currentUserId.toString()] },
            isDeleted: { $ne: true }
          } as any
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
          take: 9,
          order: { createdAt: "DESC" }
        }),
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.REQUIREMENT, isDeleted: false },
          take: 9,
          order: { createdAt: "DESC" }
        }),
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.GIVE, isDeleted: false },
          take: 9,
          order: { createdAt: "DESC" }
        }),
        this.postRepo.find({
          where: { memberId: new ObjectId(id), type: PostType.ASK, isDeleted: false },
          take: 9,
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

  /**
   * @swagger
   * /mobile-api/members/{id}/report:
   *   post:
   *     summary: Report a member profile
   *     tags: [Mobile Member]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason:
   *                 type: string
   *               comments:
   *                 type: string
   */

  /**
   * @swagger
   * /mobile-api/members/{id}/unreport:
   *   post:
   *     summary: Unreport a previously reported member
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
   *         description: Member unreported successfully
   *       400:
   *         description: Invalid member ID
   *       404:
   *         description: Member not found
   */
  @Post("/:id/unreport")
  @UseBefore(MobileAuthMiddleware)
  async unreportMember(
    @Req() req: any,
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid member ID");
      const reporterUserId = new ObjectId(req.user.userId);
      const targetUserId = new ObjectId(id);

      const member = await this.memberRepo.findOne({
        where: { _id: targetUserId, isDeleted: false }
      });
      if (!member) throw new NotFoundError("Member not found");

      // 1. Remove profile report history
      const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
      await reportedHistoryRepo.updateMany(
        {
          reporterUserId: reporterUserId,
          targetUserId: targetUserId,
          isDeleted: { $ne: true }
        },
        {
          $set: {
            status: "UNREPORTED",
            isDeleted: true,
            unreportedAt: new Date()
          }
        }
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Member unreported successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Post("/:id/report")
  @UseBefore(MobileAuthMiddleware)
  async reportMember(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { reason?: string; comments?: string },
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid member ID");
      const reporterUserId = new ObjectId(req.user.userId);
      const targetUserId = new ObjectId(id);

      if (reporterUserId.equals(targetUserId)) {
        throw new BadRequestError("You cannot report your own profile");
      }

      const member = await this.memberRepo.findOne({
        where: { _id: targetUserId, isDeleted: false }
      });
      if (!member) throw new NotFoundError("Member not found");

      const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
      const existing = await reportedHistoryRepo.findOne({
        where: { reporterUserId, targetUserId, isDeleted: { $ne: true } } as any
      });

      if (existing) {
        throw new BadRequestError("You have already reported this member");
      }

      const report = new ReportedHistory();
      report.reporterUserId = reporterUserId;
      report.targetUserId = targetUserId;
      report.moduleName = "MEMBER";
      report.reason = body.reason || body.comments || "Reported User Profile";
      report.status = "REPORTED";
      report.isDeleted = false;

      await reportedHistoryRepo.save(report);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Member reported successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}

function parseDob(dobStr: string): Date {
  const cleanStr = dobStr.trim();
  const dmyRegex = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
  const dmyMatch = cleanStr.match(dmyRegex);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  const fallbackDate = new Date(cleanStr);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }
  throw new BadRequestError("Invalid Date of Birth format. Please use DD-MM-YYYY.");
}
