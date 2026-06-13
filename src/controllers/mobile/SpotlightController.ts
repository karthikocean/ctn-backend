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
  HttpCode
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Spotlight, SpotlightStatus } from "../../entity/Spotlight";
import { SpotlightRequest, SpotlightRequestStatus } from "../../entity/SpotlightRequest";
import { Member } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { PointService } from "../../services/point.service";
import { PointConfig, PointConfigType } from "../../entity/PointConfig";

@JsonController("/spotlights")
@UseBefore(MobileAuthMiddleware)
export class MobileSpotlightController {
  private spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private spotlightRequestRepo = AppDataSource.getMongoRepository(SpotlightRequest);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
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

      const membersWithDetails = members.map(m => ({
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
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

      const pointService = new PointService();
      const config = await pointService.getPointConfig("Spotlight", PointConfigType.CREATION);
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

      const request = new SpotlightRequest();
      request.memberId = new ObjectId(memberId);
      request.status = SpotlightRequestStatus.PENDING;
      request.isDeleted = false;

      const saved = await this.spotlightRequestRepo.save(request);

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
        message: "Spotlight request submitted successfully",
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
}
