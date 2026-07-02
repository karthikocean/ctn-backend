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
import { Spotlight } from "../../entity/Spotlight";
import { SpotlightRequest, SpotlightRequestStatus } from "../../entity/SpotlightRequest";
import { SpotlightHistory, SpotlightHistoryAction } from "../../entity/SpotlightHistory";
import { Member } from "../../entity/Member";
import { CreateSpotlightDto, UpdateSpotlightDto } from "../../dto/admin/Spotlight.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { insertPushNotification } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";

@JsonController("/spotlights")
@UseBefore(AuthMiddleware, franchiseFilter)
export class SpotlightController {
  private spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private spotlightRequestRepo = AppDataSource.getMongoRepository(SpotlightRequest);
  private spotlightHistoryRepo = AppDataSource.getMongoRepository(SpotlightHistory);
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
      const date = new Date(data.scheduleDate);
      date.setMinutes(date.getMinutes() + 330); // Adjust for 5.30 hours timezone difference
      spotlight.scheduleDate = date;
      spotlight.status = data.status || spotlight.status;
      spotlight.isDeleted = false;
      spotlight.createdBy = new ObjectId(req.user.userId);
      spotlight.updatedBy = new ObjectId(req.user.userId);

      const saved = await this.spotlightRepo.save(spotlight);

      try {
        for (const memberId of saved.members) {
          const history = new SpotlightHistory();
          history.memberId = memberId;
          history.action = SpotlightHistoryAction.ASSIGNED;
          history.scheduleDate = saved.scheduleDate;
          history.performedBy = new ObjectId(req.user.userId);
          history.moduleId = saved._id;
          history.msg = `Assigned in spotlight for ${saved.scheduleDate.toISOString().split("T")[0]}.`;
          await this.spotlightHistoryRepo.save(history);
        }
      } catch (historyError) {
        console.error("Failed to log spotlight schedule creation history:", historyError);
      }

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
    @QueryParam("search") search: string,
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

      let targetMemberIds: ObjectId[] = [];
      let limitToMembers = false;

      if (req.isFranchise) {
        limitToMembers = true;
        const franchiseMembers = await this.memberRepo.find({
          where: {
            businessRegion: { $in: req.franchiseAreaIds },
            isDeleted: false
          }
        });
        const franchiseMemberIds = franchiseMembers.map(m => m._id);

        if (search) {
          const searchedMembers = await this.memberRepo.find({
            where: {
              fullName: { $regex: search, $options: "i" },
              isDeleted: false
            }
          });
          const searchedMemberIds = searchedMembers.map(m => m._id.toString());
          targetMemberIds = franchiseMemberIds.filter(id => searchedMemberIds.includes(id.toString()));
        } else {
          targetMemberIds = franchiseMemberIds;
        }
      } else if (search) {
        limitToMembers = true;
        const searchedMembers = await this.memberRepo.find({
          where: {
            fullName: { $regex: search, $options: "i" },
            isDeleted: false
          }
        });
        targetMemberIds = searchedMembers.map(m => m._id);
      }

      if (limitToMembers) {
        if (targetMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }
        where.members = { $in: targetMemberIds };
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
   * /api/admin/spotlights/history:
   *   get:
   *     summary: Get history of all spotlight requests and assignments (Admin)
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
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: List of spotlight histories
   */
  @Get("/history")
  @UseBefore(canAccess("spotlight", "view"))
  async getHistory(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("action") action: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const query: any = {};
      if (action) {
        query.action = action;
      }

      // If search is provided, we need to find member IDs matching search first
      let limitToMembers = false;
      let targetMemberIds: ObjectId[] = [];

      if (search && search.trim()) {
        const matchingMembers = await this.memberRepo.find({
          where: {
            isDeleted: false,
            $or: [
              { fullName: { $regex: search.trim(), $options: "i" } },
              { businessName: { $regex: search.trim(), $options: "i" } }
            ]
          }
        });
        targetMemberIds = matchingMembers.map(m => m._id);
        limitToMembers = true;
      }

      if (req.isFranchise) {
        // If franchise user, limit to their franchise members
        const franchiseMembers = await this.memberRepo.find({
          where: {
            franchiseId: new ObjectId(req.user.franchiseId),
            isDeleted: false
          }
        });
        const franchiseMemberIds = franchiseMembers.map(m => m._id.toString());

        if (limitToMembers) {
          targetMemberIds = targetMemberIds.filter(id => franchiseMemberIds.includes(id.toString()));
        } else {
          targetMemberIds = franchiseMembers.map(m => m._id);
          limitToMembers = true;
        }
      }

      if (limitToMembers) {
        query.memberId = { $in: targetMemberIds };
      }

      const [history, totalCount] = await this.spotlightHistoryRepo.findAndCount({
        where: query,
        order: { createdAt: "DESC" },
        skip: page * limit,
        take: limit
      });

      // Fetch member details for returning with records
      const fetchedMemberIds = history.map(h => h.memberId).filter(id => id);
      const members = fetchedMemberIds.length > 0 ? await this.memberRepo.find({
        where: { _id: { $in: fetchedMemberIds } }
      }) : [];
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      const data = history.map(h => {
        const member = memberMap.get(h.memberId.toString());
        return {
          ...h,
          member: member ? {
            fullName: member.fullName,
            businessName: member.businessName,
            profilePhoto: member.profilePhoto
          } : null
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page
      });
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
    @Req() req: any,
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

      let targetMemberIds: ObjectId[] = [];
      let limitToMembers = false;

      if (req.isFranchise) {
        limitToMembers = true;
        const franchiseMembers = await this.memberRepo.find({
          where: {
            businessRegion: { $in: req.franchiseAreaIds },
            isDeleted: false
          }
        });
        const franchiseMemberIds = franchiseMembers.map(m => m._id);

        if (search) {
          const searchedMembers = await this.memberRepo.find({
            where: {
              fullName: { $regex: search, $options: "i" },
              isDeleted: false
            }
          });
          const searchedMemberIds = searchedMembers.map(m => m._id.toString());
          targetMemberIds = franchiseMemberIds.filter(id => searchedMemberIds.includes(id.toString()));
        } else {
          targetMemberIds = franchiseMemberIds;
        }
      } else if (search) {
        limitToMembers = true;
        const searchedMembers = await this.memberRepo.find({
          where: {
            fullName: { $regex: search, $options: "i" },
            isDeleted: false
          }
        });
        targetMemberIds = searchedMembers.map(m => m._id);
      }

      if (limitToMembers) {
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
    @Req() req: any,
    @Param("id") id: string,
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

      try {
        const history = new SpotlightHistory();
        history.memberId = request.memberId;
        history.action = SpotlightHistoryAction.REQUEST_APPROVED;
        history.performedBy = new ObjectId(req.user.userId);
        history.moduleId = request._id;
        history.msg = "Spotlight request approved.";
        await this.spotlightHistoryRepo.save(history);
      } catch (historyError) {
        console.error("Failed to log spotlight request approval history:", historyError);
      }

      // Update the member's updatedAt timestamp
      const member = await this.memberRepo.findOneBy({
        _id: request.memberId,
        isDeleted: false
      });
      if (member) {
        member.updatedAt = new Date();
        await this.memberRepo.save(member);
        await insertPushNotification({
          token: member.fcmToken || "",
          subject: "Spotlight request approved",
          content: "Your spotlight request has been approved successfully.",
          moduleName: NotificationModule.SPOTLIGHT,
          moduleId: id,
          receiverId: member._id.toString()
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Spotlight request approved successfully",
        data: {
          request
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
  async rejectRequest(
    @Req() req: any,
    @Param("id") id: string, @Body() body: { reason: string }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const { reason } = body || {};
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        throw new BadRequestError("Reason is required");
      }

      const request = await this.spotlightRequestRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!request) throw new NotFoundError("Spotlight request not found");

      if (request.status !== SpotlightRequestStatus.PENDING) {
        throw new BadRequestError(`Cannot reject a request with status: ${request.status}`);
      }

      request.status = SpotlightRequestStatus.REJECTED;
      request.reason = reason.trim();
      await this.spotlightRequestRepo.save(request);

      try {
        const history = new SpotlightHistory();
        history.memberId = request.memberId;
        history.action = SpotlightHistoryAction.REQUEST_REJECTED;
        history.reason = reason.trim();
        history.performedBy = new ObjectId(req.user.userId);
        history.moduleId = request._id;
        history.msg = `Spotlight request rejected. Reason: ${reason.trim()}`;
        await this.spotlightHistoryRepo.save(history);
      } catch (historyError) {
        console.error("Failed to log spotlight request rejection history:", historyError);
      }
      const member = await this.memberRepo.findOneBy({
        _id: request.memberId,
        isDeleted: false
      });
      if (member) {
        await insertPushNotification({
          token: member.fcmToken || "",
          subject: "Spotlight request rejected",
          content: `Your spotlight request has been rejected. Reason: ${reason.trim()}`,
          moduleName: NotificationModule.SPOTLIGHT,
          moduleId: id,
          receiverId: member._id.toString()
        });
      }
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

      const oldMembers = spotlight.members ? spotlight.members.map(m => m.toString()) : [];
      const oldDate = spotlight.scheduleDate;

      if (data.members) spotlight.members = data.members.map(id => new ObjectId(id));
      if (data.scheduleDate) {
        const date = new Date(data.scheduleDate);
        date.setMinutes(date.getMinutes() + 330); // Adjust for 5.30 hours timezone difference
        spotlight.scheduleDate = date;
      }
      if (data.status) spotlight.status = data.status;
      spotlight.updatedBy = new ObjectId(req.user.userId);

      const saved = await this.spotlightRepo.save(spotlight);

      try {
        const newMembers = saved.members || [];
        const newDate = saved.scheduleDate;
        const dateChanged = oldDate ? oldDate.getTime() !== newDate.getTime() : true;

        for (const memberId of newMembers) {
          const memberIdStr = memberId.toString();
          if (dateChanged || !oldMembers.includes(memberIdStr)) {
            const history = new SpotlightHistory();
            history.memberId = memberId;
            history.action = SpotlightHistoryAction.ASSIGNED;
            history.scheduleDate = newDate;
            history.performedBy = new ObjectId(req.user.userId);
            history.moduleId = saved._id;
            history.msg = `Assigned in spotlight for ${newDate.toISOString().split("T")[0]}.`;
            await this.spotlightHistoryRepo.save(history);
          }
        }
      } catch (historyError) {
        console.error("Failed to log spotlight schedule update history:", historyError);
      }

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

}
