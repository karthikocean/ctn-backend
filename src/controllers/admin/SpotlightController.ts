import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  UseBefore,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Spotlight, SpotlightStatus } from "../../entity/Spotlight";
import { SpotlightRequest, SpotlightRequestStatus } from "../../entity/SpotlightRequest";
import { Member } from "../../entity/Member";
import { CreateSpotlightDto, UpdateSpotlightDto } from "../../dto/admin/Spotlight.dto";
import { ApproveSpotlightRequestDto } from "../../dto/admin/SpotlightRequest.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";

@JsonController("/spotlights")
@UseBefore(AuthMiddleware, franchiseFilter)
export class SpotlightController {
  private spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private spotlightRequestRepo = AppDataSource.getMongoRepository(SpotlightRequest);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/admin/spotlights:
   *   post:
   *     summary: Create a new spotlight schedule
   *     tags: [Spotlight]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSpotlightDto'
   *     responses:
   *       201:
   *         description: Spotlight scheduled successfully
   */
  @Post("/")
  @UseBefore(canAccess("spotlight", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreateSpotlightDto, @Res() res: any) {
    try {
      const spotlight = new Spotlight();
      spotlight.members = data.members.map(id => new ObjectId(id));
      spotlight.scheduleDate = new Date(data.scheduleDate);
      spotlight.status = data.status || spotlight.status;
      spotlight.isDeleted = false;
      spotlight.createdBy = new ObjectId(req.user.userId);
      spotlight.updatedBy = new ObjectId(req.user.userId);

      const saved = await this.spotlightRepo.save(spotlight);
      return res.status(StatusCodes.CREATED).json({
        message: "Spotlight scheduled successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights:
   *   get:
   *     summary: Get all spotlight schedules with pagination and search
   *     tags: [Spotlight]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: status
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: List of spotlight schedules
   */
  @Get("/")
  @UseBefore(canAccess("spotlight", "view"))
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (req.isFranchise) {
        where.createdBy = new ObjectId(req.user.userId);
      }
      if (status) {
        where.status = status;
      }

      const [spotlights, total] = await this.spotlightRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { scheduleDate: "DESC" }
      });

      // Fetch member details for the response
      const allMemberIds = spotlights.reduce((acc: ObjectId[], s) => {
        return [...acc, ...s.members];
      }, []);

      const uniqueMemberIds = Array.from(new Set(allMemberIds.map(id => id.toString()))).map(id => new ObjectId(id));

      const members = await this.memberRepo.find({
        where: { _id: { $in: uniqueMemberIds } }
      });

      const memberMap = members.reduce((acc: any, m) => {
        acc[m._id.toString()] = { _id: m._id, fullName: m.fullName };
        return acc;
      }, {});

      const spotlightsWithMembers = spotlights.map(s => ({
        ...s,
        members: s.members.map(id => memberMap[id.toString()] || { _id: id, fullName: "Unknown Member" })
      }));

      return pagination(total, spotlightsWithMembers, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/{id}:
   *   get:
   *     summary: Get a single spotlight by ID
   *     tags: [Spotlight]
   */
  @Get("/:id")
  @UseBefore(canAccess("spotlight", "view"))
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const spotlight = await this.spotlightRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!spotlight) throw new NotFoundError("Spotlight not found");

      if (req.isFranchise) {
        if (!spotlight.createdBy || spotlight.createdBy.toString() !== req.user.userId) {
          throw new NotFoundError("Spotlight not found");
        }
      }

      // Fetch member details
      const members = await this.memberRepo.find({
        where: { _id: { $in: spotlight.members } }
      });

      const spotlightWithMembers = {
        ...spotlight,
        members: members.map(m => ({ _id: m._id, fullName: m.fullName }))
      };

      return res.status(StatusCodes.OK).json(spotlightWithMembers);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/{id}:
   *   put:
   *     summary: Update a spotlight schedule
   *     tags: [Spotlight]
   */
  @Put("/:id")
  @UseBefore(canAccess("spotlight", "edit"))
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdateSpotlightDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const spotlight = await this.spotlightRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!spotlight) throw new NotFoundError("Spotlight not found");

      if (req.isFranchise) {
        if (!spotlight.createdBy || spotlight.createdBy.toString() !== req.user.userId) {
          throw new BadRequestError("You are not authorized to update this spotlight");
        }
      }

      if (data.members) spotlight.members = data.members.map(id => new ObjectId(id));
      if (data.scheduleDate) spotlight.scheduleDate = new Date(data.scheduleDate);
      if (data.status) spotlight.status = data.status;
      spotlight.updatedBy = new ObjectId(req.user.userId);

      const saved = await this.spotlightRepo.save(spotlight);
      return res.status(StatusCodes.OK).json({
        message: "Spotlight updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/{id}:
   *   delete:
   *     summary: Delete a spotlight schedule (Soft Delete)
   *     tags: [Spotlight]
   */
  @Delete("/:id")
  @UseBefore(canAccess("spotlight", "delete"))
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const spotlight = await this.spotlightRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!spotlight) throw new NotFoundError("Spotlight not found");

      if (req.isFranchise) {
        if (!spotlight.createdBy || spotlight.createdBy.toString() !== req.user.userId) {
          throw new BadRequestError("You are not authorized to delete this spotlight");
        }
      }

      spotlight.isDeleted = true;
      spotlight.updatedBy = new ObjectId(req.user.userId);
      await this.spotlightRepo.save(spotlight);

      return res.status(StatusCodes.OK).json({ message: "Spotlight deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/requests:
   *   get:
   *     summary: List all spotlight requests (Admin)
   *     tags: [Spotlight]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: status
   *         schema: { type: string }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: List of spotlight requests
   */
  @Get("/requests")
  @UseBefore(canAccess("spotlight", "view"))
  async getAllRequests(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("status") status: string,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (status) {
        where.status = status;
      }

      // If searching by member name, we need to find members matching search
      let targetMemberIds: ObjectId[] = [];
      let searchActive = false;

      if (search) {
        searchActive = true;
        const members = await this.memberRepo.find({
          where: {
            fullName: { $regex: search, $options: "i" },
            isDeleted: false
          }
        });
        targetMemberIds = members.map(m => m._id);
      }

      if (searchActive) {
        if (targetMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }
        where.memberId = { $in: targetMemberIds };
      }

      const [requests, total] = await this.spotlightRequestRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Fetch member details for requests
      const memberIds = requests.map(r => r.memberId);
      const uniqueMemberIds = Array.from(new Set(memberIds.map(id => id.toString()))).map(id => new ObjectId(id));

      let memberMap = new Map();
      if (uniqueMemberIds.length > 0) {
        const members = await this.memberRepo.find({
          where: { _id: { $in: uniqueMemberIds } }
        });
        memberMap = new Map(members.map(m => [m._id.toString(), {
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto,
          businessName: m.businessName
        }]));
      }

      const requestsWithMembers = requests.map(r => ({
        ...r,
        member: memberMap.get(r.memberId.toString()) || { _id: r.memberId, fullName: "Unknown Member" }
      }));

      return pagination(total, requestsWithMembers, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/requests/{id}/approve:
   *   put:
   *     summary: Approve a spotlight request and schedule it (Admin)
   *     tags: [Spotlight]
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
   *             $ref: '#/components/schemas/ApproveSpotlightRequestDto'
   */
  @Put("/requests/:id/approve")
  @UseBefore(canAccess("spotlight", "edit"))
  async approveRequest(
    @Param("id") id: string,
    @Body() data: ApproveSpotlightRequestDto,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const request = await this.spotlightRequestRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!request) throw new NotFoundError("Spotlight request not found");

      if (request.status !== SpotlightRequestStatus.PENDING) {
        throw new BadRequestError(`Cannot approve a request with status: ${request.status}`);
      }

      // 1. Update the request status
      request.status = SpotlightRequestStatus.APPROVED;
      await this.spotlightRequestRepo.save(request);

      // 2. Create the Spotlight schedule
      const spotlight = new Spotlight();
      spotlight.members = [request.memberId];
      spotlight.scheduleDate = new Date(data.scheduleDate);
      spotlight.status = SpotlightStatus.SCHEDULE;
      spotlight.isDeleted = false;

      const savedSpotlight = await this.spotlightRepo.save(spotlight);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Spotlight request approved and scheduled successfully",
        data: {
          request,
          spotlight: savedSpotlight
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/requests/{id}/reject:
   *   put:
   *     summary: Reject a spotlight request (Admin)
   *     tags: [Spotlight]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Put("/requests/:id/reject")
  @UseBefore(canAccess("spotlight", "edit"))
  async rejectRequest(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const request = await this.spotlightRequestRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!request) throw new NotFoundError("Spotlight request not found");

      if (request.status !== SpotlightRequestStatus.PENDING) {
        throw new BadRequestError(`Cannot reject a request with status: ${request.status}`);
      }

      request.status = SpotlightRequestStatus.REJECTED;
      await this.spotlightRequestRepo.save(request);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Spotlight request rejected successfully",
        data: request
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/requests/{id}:
   *   delete:
   *     summary: Soft delete a spotlight request (Admin)
   *     tags: [Spotlight]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Delete("/requests/:id")
  @UseBefore(canAccess("spotlight", "delete"))
  async deleteRequest(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const request = await this.spotlightRequestRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!request) throw new NotFoundError("Spotlight request not found");

      request.isDeleted = true;
      await this.spotlightRequestRepo.save(request);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Spotlight request deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
