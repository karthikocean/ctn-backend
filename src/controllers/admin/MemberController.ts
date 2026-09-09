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
import { Connection } from "../../entity/Connection";
import { Category } from "../../entity/Category";
import { BusinessRegion, Area } from "../../entity/BusinessRegion";
import { State } from "../../entity/State";
import { City } from "../../entity/City";
import { PostModel, PostType } from "../../entity/Post";
import { CreateMemberDto } from "../../dto/mobile/Member.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import bcrypt from "bcryptjs";
import imageService from "../../utils/upload";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { MailService } from "../../services/mail.service";
import { WelcomeCardService } from "../../services/welcomeCard.service";
import { Plan } from "../../entity/Plan";
import { MemberSubscription } from "../../entity/MemberSubscription";
import { resolveRegions, resolveRegion } from "../../utils/region.helper";

@JsonController("/members")
@UseBefore(AuthMiddleware, franchiseFilter)
export class AdminMemberController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private planRepo = AppDataSource.getMongoRepository(Plan);
  private subscriptionRepo = AppDataSource.getMongoRepository(MemberSubscription);

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
      member.points = 0;
      member.status = MemberStatus.ACTIVE;
      member.lastLoggedIn = new Date();
      // Default PIN sourced from env — MEMBER_DEFAULT_PIN must be set and communicated to the member securely
      const defaultPin = process.env.MEMBER_DEFAULT_PIN ||
        Math.random().toString(36).slice(-8).toUpperCase(); // secure random fallback
      member.pin = await bcrypt.hash(defaultPin, 10); // Default PIN hashed for members registered by Admin

      const saved = await this.memberRepo.save(member);

      // Send welcome email if email is provided
      if (saved.email) {
        try {
          await MailService.sendWelcomeMemberEmail({
            fullName: saved.fullName,
            email: saved.email,
            mobileNumber: saved.mobileNumber,
            pin: defaultPin
          });
        } catch (mailError: any) {
          console.error(`[AdminRegister] Failed to send welcome email to ${saved.email}:`, mailError.message);
        }
      }

      // Generate official Welcome Card PNG and notify admin@trustednetwork.in
      WelcomeCardService.sendRegistrationWelcomeEmailToAdmin(saved).catch(err => {
        console.error(`[AdminRegister] Welcome email to admin notice for member ${saved._id}:`, err.message);
      });

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
    @QueryParam("activityFilter") activityFilter: string,
    @QueryParam("joinedStart") joinedStart: string,
    @QueryParam("joinedEnd") joinedEnd: string,
    @QueryParam("expiredStart") expiredStart: string,
    @QueryParam("expiredEnd") expiredEnd: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (activityFilter) {
        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);

        let targetType: PostType | null = null;
        if (activityFilter === "notPosted") targetType = PostType.PROMOTION;
        else if (activityFilter === "notAsked") targetType = PostType.ASK;
        else if (activityFilter === "notGiven") targetType = PostType.GIVE;
        else if (activityFilter === "notRequirements") targetType = PostType.REQUIREMENT;

        if (targetType) {
          const postRepo = AppDataSource.getMongoRepository(PostModel);
          const postsToday = await postRepo.find({
            where: {
              type: targetType,
              isDeleted: false,
              createdAt: { $gte: startOfToday, $lte: endOfToday }
            }
          });
          const memberIdsWithPosts = postsToday.map(p => p.memberId).filter(Boolean);
          if (memberIdsWithPosts.length > 0) {
            where._id = { $nin: memberIdsWithPosts };
          }
        }
      }

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

      if (joinedStart && joinedEnd) {
        where.createdAt = {
          $gte: new Date(joinedStart),
          $lte: new Date(joinedEnd)
        };
      }

      if (expiredStart && expiredEnd) {
        // Only members whose subscription has already expired (≤ today)
        const today = new Date().toISOString();
        const effectiveEnd = expiredEnd < today ? expiredEnd : today;
        where.subscriptionEndDate = {
          $gte: expiredStart,
          $lte: effectiveEnd
        };
      }

      const [members, total] = await this.memberRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Populate Categories
      const categoryIds = members
        .flatMap(m => [m.businessCategory, m.subCategory])
        .filter((id): id is ObjectId => !!id);

      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), { _id: c._id, name: c.name }]));

      // Populate Plans
      const planIds = members
        .map(m => m.planId)
        .filter((id): id is ObjectId => !!id && ObjectId.isValid(id));

      const plans = planIds.length > 0
        ? await this.planRepo.find({ where: { _id: { $in: planIds } } as any })
        : [];

      const planMap = new Map(plans.map(p => [p._id.toString(), p.title]));

      // Populate Business Region / Area
      const regionIds = [
        ...new Set(
          members
            .map(m => m.businessRegion)
            .filter((id): id is ObjectId => !!id && ObjectId.isValid(id))
            .map(id => new ObjectId(id))
        )
      ];

      const areaMap = new Map<string, { _id: ObjectId; name: string }>();

      if (regionIds.length > 0) {
        const regions = await this.businessRegionRepo.find({
          where: {
            $or: [
              { _id: { $in: regionIds } },
              { "areas._id": { $in: regionIds } }
            ],
            isDeleted: false
          } as any
        });

        const resolvedRegions = await resolveRegions(regions);
        for (const r of resolvedRegions) {
          if (r._id) {
            areaMap.set(r._id.toString(), {
              _id: r._id,
              name: r.name || r.city || r.state || "Region"
            });
          }
          if (r.areas && Array.isArray(r.areas)) {
            for (const a of r.areas) {
              if (a._id) {
                areaMap.set(a._id.toString(), {
                  _id: a._id,
                  name: a.name
                });
              }
            }
          }
        }
      }

      const data = members.map(m => {
        const areaInfo = m.businessRegion ? areaMap.get(m.businessRegion.toString()) || null : null;
        return {
          ...m,
          businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null,
          subCategory: m.subCategory ? categoryMap.get(m.subCategory.toString()) : null,
          businessRegion: areaInfo || m.businessRegion,
          planName: (m.planId && planMap.get(m.planId.toString())) || null
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
      if (member.planId) {
        const plan = await this.planRepo.findOneBy({ _id: member.planId });
        populated.planName = plan ? plan.title : null;
      } else {
        populated.planName = null;
      }

      if (member.businessRegion && ObjectId.isValid(member.businessRegion)) {
        const regionOid = new ObjectId(member.businessRegion);
        const region = await this.businessRegionRepo.findOne({
          where: {
            $or: [
              { _id: regionOid },
              { "areas._id": regionOid }
            ],
            isDeleted: false
          } as any
        });
        if (region) {
          const resolved = await resolveRegion(region);
          const matchedArea = resolved?.areas?.find((a: any) => a._id?.toString() === regionOid.toString());
          if (matchedArea) {
            populated.businessRegion = { _id: matchedArea._id, name: matchedArea.name };
          } else {
            populated.businessRegion = {
              _id: resolved._id,
              name: resolved.name || resolved.city || resolved.state || "Region"
            };
          }
        } else {
          populated.businessRegion = { _id: member.businessRegion, name: "Unknown" };
        }
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
   * /api/admin/members/{id}/welcome-card:
   *   get:
   *     summary: Download welcome card PNG for a member (Admin)
   *     tags: [Admin Member]
   */
  @Get("/:id/welcome-card")
  async downloadWelcomeCard(@Req() req: any, @Param("id") id: string, @Res() res: any) {
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

      const pngBuffer = await WelcomeCardService.generateWelcomeCardPng(member);
      const safeName = (member.fullName || "Member").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Welcome_Card_${safeName}.png`;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pngBuffer.length);
      return res.send(pngBuffer);
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

      // Permanently delete all connections for this member
      const connectionRepo = AppDataSource.getMongoRepository(Connection);
      await connectionRepo.deleteMany({
        $or: [
          { senderId: new ObjectId(id) },
          { receiverId: new ObjectId(id) }
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
        message: "Member deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

}
