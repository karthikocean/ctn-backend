import {
  JsonController,
  Get,
  Post,
  Delete,
  Param,
  Res,
  Req,
  UseBefore,
  BadRequestError,
  NotFoundError,
  HttpCode,
  QueryParam
} from "routing-controllers";
import pagination from "../../utils/pagination";
import { AppDataSource } from "../../data-source";
import { Spotlight, SpotlightStatus } from "../../entity/Spotlight";
import { SpotlightRequest, SpotlightRequestStatus } from "../../entity/SpotlightRequest";
import { SpotlightHistory, SpotlightHistoryAction } from "../../entity/SpotlightHistory";
import { Member } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { PointService } from "../../services/point.service";
import { PointConfig, PointConfigType } from "../../entity/PointConfig";
import { validateFeatureAccess } from "../../services/moduleUsage.service";

@JsonController("/spotlights")
@UseBefore(MobileAuthMiddleware)
export class MobileSpotlightController {
  private spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private spotlightRequestRepo = AppDataSource.getMongoRepository(SpotlightRequest);
  private spotlightHistoryRepo = AppDataSource.getMongoRepository(SpotlightHistory);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private configRepo = AppDataSource.getMongoRepository(PointConfig);

  /**
   * @swagger
   * /mobile-api/spotlights/active:
   *   get:
   *     summary: Get the currently active spotlight
   *     tags: [Mobile Spotlight]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Active spotlight data
   */
  @Get("/active")
  async getActive(@Res() res: any) {
    try {
      const spotlight = await this.spotlightRepo.findOne({
        where: {
          status: SpotlightStatus.ACTIVE,
          isDeleted: false
        },
        order: { scheduleDate: "DESC" }
      });

      if (!spotlight) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: null
        });
      }

      // Fetch member details
      const members = await this.memberRepo.find({
        where: {
          _id: { $in: spotlight.members },
          isDeleted: false
        }
      });

      // Fetch categories for members
      const categoryIds = members
        .map(m => m.businessCategory)
        .filter(id => id) as ObjectId[];

      let categoryMap = new Map();
      if (categoryIds.length > 0) {
        const categories = await this.categoryRepo.find({
          where: { _id: { $in: categoryIds } }
        });
        categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));
      }

      const regionMap = await this.buildRegionMap(members);

      const membersWithDetails = members.map(m => ({
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto ?? null,
        profileBanner: m.profileBanner ?? null,
        businessName: m.businessName ?? null,
        categoryName: m.businessCategory
          ? (categoryMap.get(m.businessCategory.toString()) ?? null)
          : null,
        regionName: m.businessRegion
          ? (regionMap.get(m.businessRegion.toString()) ?? null)
          : null,
        city: m.city ?? null,
        about: m.about ?? null
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...spotlight,
          members: membersWithDetails
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/spotlights/requests:
   *   post:
   *     summary: Request to be added as a spotlight person (Mobile)
   *     tags: [Mobile Spotlight]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       201:
   *         description: Created spotlight request
   */
  @Post("/requests")
  @HttpCode(StatusCodes.CREATED)
  async createRequest(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;

      // Check if member's plan includes the Spotlights feature
      await validateFeatureAccess(
        new ObjectId(memberId),
        "spotlights",
        "Spotlights"
      );

      // Verify if member has a pending spotlight request
      const existingRequest = await this.spotlightRequestRepo.findOne({
        where: {
          memberId: new ObjectId(memberId),
          status: SpotlightRequestStatus.PENDING,
          isDeleted: false
        }
      });

      if (existingRequest) {
        throw new BadRequestError("You already have a pending spotlight request");
      }

      // Verify if member is already in an active or scheduled spotlight
      const existingSpotlight = await this.spotlightRepo.findOne({
        where: {
          members: new ObjectId(memberId),
          status: { $in: [SpotlightStatus.ACTIVE, SpotlightStatus.SCHEDULE] } as any,
          isDeleted: false
        }
      });

      if (existingSpotlight) {
        throw new BadRequestError("You are already in the spotlight");
      }

      const pointService = new PointService();
      const config = await pointService.getPointConfig("Spotlight", PointConfigType.SPENT);
      const pointsToDeduct = config ? config.points : 0;

      let member = null;
      if (pointsToDeduct > 0) {
        member = await this.memberRepo.findOneBy({ _id: new ObjectId(memberId) });
        if (!member) {
          throw new NotFoundError("Member not found");
        }
        if ((member.points || 0) < pointsToDeduct) {
          throw new BadRequestError(`Insufficient points. You need ${pointsToDeduct} points.`);
        }
      }

      // Check count of auto-approved spotlight requests today (limit 50 per day for auto-approval)
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      const approvedTodayCount = await this.spotlightRequestRepo.count({
        where: {
          status: SpotlightRequestStatus.APPROVED,
          createdAt: { $gte: startOfDay, $lte: endOfDay } as any,
          isDeleted: false
        }
      });

      const isAutoApprove = approvedTodayCount < 50;

      const request = new SpotlightRequest();
      request.memberId = new ObjectId(memberId);
      request.status = isAutoApprove ? SpotlightRequestStatus.APPROVED : SpotlightRequestStatus.PENDING;
      if (isAutoApprove) {
        request.assignedDate = new Date();
      }
      request.isDeleted = false;

      const saved = await this.spotlightRequestRepo.save(request);

      if (isAutoApprove) {
        // Automatically push/create into spotlight creation
        let spotlight = await this.spotlightRepo.findOne({
          where: {
            scheduleDate: { $gte: startOfDay, $lte: endOfDay } as any,
            isDeleted: false
          }
        });

        if (spotlight) {
          const memberIdStr = memberId.toString();
          if (!spotlight.members.some(m => m.toString() === memberIdStr)) {
            spotlight.members.push(new ObjectId(memberId));
            await this.spotlightRepo.save(spotlight);
          }
        } else {
          spotlight = new Spotlight();
          spotlight.members = [new ObjectId(memberId)];
          spotlight.scheduleDate = new Date();
          spotlight.status = SpotlightStatus.ACTIVE;
          spotlight.isDeleted = false;
          spotlight.createdBy = new ObjectId(memberId);
          spotlight.updatedBy = new ObjectId(memberId);
          await this.spotlightRepo.save(spotlight);
        }
      }

      try {
        const history = new SpotlightHistory();
        history.memberId = new ObjectId(memberId);
        history.action = isAutoApprove ? SpotlightHistoryAction.REQUEST_APPROVED : SpotlightHistoryAction.REQUEST_CREATED;
        history.performedBy = new ObjectId(memberId);
        history.moduleId = saved._id;
        history.msg = isAutoApprove ? "Spotlight request auto-approved." : "Spotlight request submitted.";
        await this.spotlightHistoryRepo.save(history);
      } catch (historyError) {
        console.error("Failed to log spotlight request history:", historyError);
      }

      let remainingPoints = 0;
      if (pointsToDeduct > 0 && member) {
        try {
          const deductResult = await pointService.deductPoints({
            memberId: new ObjectId(memberId),
            moduleName: "Spotlight",
            points: pointsToDeduct,
            referenceId: saved._id,
            actionType: "spent"
          });
          remainingPoints = deductResult.balance;
        } catch (pointError) {
          console.error("Failed to record spotlight points deduction in history:", pointError);
          member.points = Math.max(0, (member.points || 0) - pointsToDeduct);
          await this.memberRepo.save(member);
          remainingPoints = member.points;
        }
      } else {
        const balance = await pointService.getMemberBalance(new ObjectId(memberId));
        remainingPoints = balance;
      }

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: isAutoApprove
          ? "Your profile has been added to spotlight successfully"
          : "Spotlight request submitted successfully",
        data: saved,
        remainingPoints,
        pointsSpent: pointsToDeduct
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/spotlights/requests:
   *   get:
   *     summary: Get requests submitted by the logged-in member (Mobile)
   *     tags: [Mobile Spotlight]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of my spotlight requests
   */
  @Get("/requests")
  async getMyRequests(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;

      const requests = await this.spotlightRequestRepo.find({
        where: {
          memberId: new ObjectId(memberId),
          isDeleted: false
        },
        order: { createdAt: "DESC" }
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: requests
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/spotlights/requests/{id}:
   *   delete:
   *     summary: Cancel a pending spotlight request (Mobile)
   *     tags: [Mobile Spotlight]
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
   *         description: Spotlight request cancelled successfully
   */
  @Delete("/requests/:id")
  async cancelRequest(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const memberId = req.user.userId;

      const request = await this.spotlightRequestRepo.findOneBy({
        _id: new ObjectId(id),
        memberId: new ObjectId(memberId),
        isDeleted: false
      });

      if (!request) {
        throw new NotFoundError("Spotlight request not found");
      }

      if (request.status !== SpotlightRequestStatus.PENDING) {
        throw new BadRequestError("Only pending requests can be cancelled");
      }

      request.isDeleted = true;
      await this.spotlightRequestRepo.save(request);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Spotlight request cancelled successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }

  }

  /**
   * @swagger
   * /mobile-api/spotlights/point-config:
   *   get:
   *     summary: Get point configurations for Spotlight module (Mobile)
   *     tags: [Mobile Spotlight]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Point configuration details for Spotlight
   */
  @Get("/point-config")
  async getPointConfig(@Res() res: any) {
    try {
      const configs = await this.configRepo.find({
        where: {
          moduleName: { $regex: new RegExp("^Spotlight$", "i") },
          isDeleted: false,
          type: PointConfigType.SPENT
        }
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: configs
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/spotlights/list:
   *   get:
   *     summary: Get paginated flat list of members from active spotlights (Mobile)
   *     tags: [Mobile Spotlight]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 0
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *     responses:
   *       200:
   *         description: Flat list of members from active spotlights
   */
  @Get("/list")
  async getList(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      const pageNum = Number(page) || 0;
      const limitNum = Number(limit) || 10;

      // Fetch only active spotlights
      const spotlights = await this.spotlightRepo.find({
        where: { isDeleted: false, status: SpotlightStatus.ACTIVE },
        order: { scheduleDate: "DESC" }
      });

      if (spotlights.length === 0) {
        return res.status(StatusCodes.OK).json({ success: true, data: [] });
      }

      // Collect all unique member IDs across active spotlights
      const allMemberIds = [
        ...new Set(
          spotlights.flatMap(s => s.members.map(id => id.toString()))
        )
      ].map(id => new ObjectId(id));

      // Fetch member records
      const members = allMemberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: allMemberIds }, isDeleted: false } as any })
        : [];

      // Fetch categories for those members
      const categoryIds = [
        ...new Set(
          members.map(m => m.businessCategory?.toString()).filter(Boolean)
        )
      ].map(id => new ObjectId(id!));

      let categoryMap = new Map<string, string>();
      if (categoryIds.length > 0) {
        const categories = await this.categoryRepo.find({
          where: { _id: { $in: categoryIds } } as any
        });
        categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));
      }

      const regionMap = await this.buildRegionMap(members);

      // Build flat member list with pagination
      const allMembers = members.map(m => ({
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto ?? null,
        profileBanner: m.profileBanner ?? null,
        businessName: m.businessName ?? null,
        categoryName: m.businessCategory
          ? (categoryMap.get(m.businessCategory.toString()) ?? null)
          : null,
        regionname: m.businessRegion
          ? (regionMap.get(m.businessRegion.toString()) ?? null)
          : null,
        regionName: m.businessRegion
          ? (regionMap.get(m.businessRegion.toString()) ?? null)
          : null,
        city: m.city ?? null,
        about: m.about ?? null
      }));

      // Random shuffle using Math.random() (Fisher-Yates shuffle algorithm)
      for (let i = allMembers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allMembers[i], allMembers[j]] = [allMembers[j], allMembers[i]];
      }

      const total = allMembers.length;
      const data = allMembers.slice(pageNum * limitNum, pageNum * limitNum + limitNum);

      return pagination(total, data, limitNum, pageNum, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/spotlights/history:
   *   get:
   *     summary: Get spotlight history for the logged-in member (Mobile)
   *     tags: [Mobile Spotlight]
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
   *     responses:
   *       200:
   *         description: Spotlight history list
   */
  @Get("/history")
  async getHistory(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      const memberId = req.user.userId;
      const pageNum = Number(page) || 0;
      const limitNum = Number(limit) || 10;

      const [history, total] = await this.spotlightHistoryRepo.findAndCount({
        where: {
          memberId: new ObjectId(memberId)
        },
        order: { createdAt: "DESC" },
        skip: pageNum * limitNum,
        take: limitNum
      });

      return pagination(total, history, limitNum, pageNum, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private async buildRegionMap(members: Member[]): Promise<Map<string, string>> {
    const regionIds = [
      ...new Set(
        members.map(m => m.businessRegion?.toString()).filter(Boolean)
      )
    ].map(id => new ObjectId(id!));

    const regionMap = new Map<string, string>();
    if (regionIds.length > 0) {
      const regions = await this.businessRegionRepo.find({
        where: {
          $or: [
            { _id: { $in: regionIds } },
            { "areas._id": { $in: regionIds } }
          ]
        } as any
      });

      for (const r of regions) {
        if (r.areas && Array.isArray(r.areas)) {
          for (const area of r.areas) {
            if (area._id) {
              regionMap.set(area._id.toString(), area.name || "Region");
            }
          }
        }
        if (r._id) {
          const rName = (r as any).name || (r as any).regionName || (r.areas && r.areas[0]?.name) || "Region";
          if (!regionMap.has(r._id.toString())) {
            regionMap.set(r._id.toString(), rName);
          }
        }
      }
    }
    return regionMap;
  }
}
