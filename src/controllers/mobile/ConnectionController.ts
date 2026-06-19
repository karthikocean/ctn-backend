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
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { Member, MemberStatus } from "../../entity/Member";
import { CreateConnectionDto, UpdateConnectionStatusDto } from "../../dto/mobile/Connection.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { insertPushNotification } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";

@JsonController("/connections")
@UseBefore(MobileAuthMiddleware)
export class MobileConnectionController {
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /mobile-api/connections:
   *   post:
   *     summary: Send a connection request
   *     tags: [Mobile Connection]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateConnectionDto'
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async sendRequest(@Req() req: any, @Body() data: CreateConnectionDto, @Res() res: any) {
    try {
      const senderId = req.user.userId;
      const { receiverId } = data;

      if (senderId === receiverId) {
        throw new BadRequestError("You cannot connect with yourself");
      }

      if (!ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid receiver ID");
      }

      // Check if receiver exists
      const receiver = await this.memberRepo.findOneBy({ _id: new ObjectId(receiverId), isDeleted: false });
      if (!receiver) throw new NotFoundError("Receiver not found");

      // Check if already connected or request pending (only in THIS direction)
      const existing = await this.connectionRepo.findOne({
        where: {
          senderId: new ObjectId(senderId),
          receiverId: new ObjectId(receiverId),
          status: { $ne: ConnectionStatus.CANCELLED }
        } as any
      });

      if (existing) {
        return res.status(StatusCodes.OK).json({
          success: false,
          message: `Connection already exists or is pending (Status: ${existing.status})`,
          data: existing
        });
      }
      // auto following
      const connectionFOllow = new Connection();
      connectionFOllow.senderId = new ObjectId(senderId);
      connectionFOllow.receiverId = new ObjectId(receiverId);
      connectionFOllow.status = ConnectionStatus.ACCEPTED;
      await this.connectionRepo.save(connectionFOllow);

      // pending request for follow back
      const connection = new Connection();
      connection.senderId = new ObjectId(receiverId);
      connection.receiverId = new ObjectId(senderId);
      connection.status = ConnectionStatus.PENDING;

      const saved = await this.connectionRepo.save(connection);

      // ✅ Send Notification to Receiver
      if (receiver.fcmToken) {
        const sender = await this.memberRepo.findOneBy({ _id: new ObjectId(senderId), isDeleted: false });
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: "New Connection Request",
          content: `${sender?.fullName || "A member"} has sent you a connection request.`,
          moduleName: NotificationModule.CONNECTION,
          moduleId: saved._id.toString(),
          receiverId: receiverId,
          senderId: senderId
        });
      }

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Connection request sent successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/connections/follow:
   *   post:
   *     summary: Automatically follow a member (creates an accepted connection)
   *     tags: [Mobile Connection]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateConnectionDto'
   */
  @Post("/follow")
  @HttpCode(StatusCodes.OK)
  async followMember(@Req() req: any, @Body() data: CreateConnectionDto, @Res() res: any) {
    try {
      const senderId = req.user.userId;
      const { receiverId } = data;

      if (senderId === receiverId) {
        throw new BadRequestError("You cannot follow yourself");
      }

      if (!ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid receiver ID");
      }

      // Check if receiver exists
      const receiver = await this.memberRepo.findOneBy({ _id: new ObjectId(receiverId), isDeleted: false });
      if (!receiver) throw new NotFoundError("Receiver not found");

      // Check if already connected or request exists (in THIS direction)
      let connection = await this.connectionRepo.findOne({
        where: {
          senderId: new ObjectId(senderId),
          receiverId: new ObjectId(receiverId)
        } as any
      });

      if (connection) {
        if (connection.status === ConnectionStatus.ACCEPTED) {
          return res.status(StatusCodes.OK).json({
            success: true,
            message: "You are already following this member",
            data: connection
          });
        }

        if (connection.status === ConnectionStatus.BLOCKED) {
          throw new BadRequestError("You cannot follow this member because they are blocked");
        }

        // For any other status (PENDING, REJECTED, CANCELLED), directly accept/follow
        connection.status = ConnectionStatus.ACCEPTED;
      } else {
        console.log("inisssssssssss");

        // Create new accepted connection
        connection = new Connection();
        connection.senderId = new ObjectId(senderId);
        connection.receiverId = new ObjectId(receiverId);
        connection.status = ConnectionStatus.ACCEPTED;
      }

      const saved = await this.connectionRepo.save(connection);

      // ✅ Send Notification to Receiver (custom follow message)
      if (receiver.fcmToken) {
        const sender = await this.memberRepo.findOneBy({ _id: new ObjectId(senderId), isDeleted: false });
        await insertPushNotification({
          token: receiver.fcmToken,
          subject: "New Follower",
          content: `${sender?.fullName || "A member"} is following you. Please follow back!`,
          moduleName: NotificationModule.CONNECTION,
          moduleId: saved._id.toString(),
          receiverId: receiverId,
          senderId: senderId
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "You are now following this member",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/connections/unfollow:
   *   post:
   *     summary: Unfollow a member
   *     tags: [Mobile Connection]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateConnectionDto'
   */
  @Post("/unfollow")
  @HttpCode(StatusCodes.OK)
  async unfollowMember(@Req() req: any, @Body() data: CreateConnectionDto, @Res() res: any) {
    try {
      const senderId = req.user.userId;
      const { receiverId } = data;

      if (!ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid receiver ID");
      }

      // Check if connection exists in this direction
      const connection = await this.connectionRepo.findOne({
        where: {
          senderId: new ObjectId(senderId),
          receiverId: new ObjectId(receiverId),
          status: ConnectionStatus.ACCEPTED
        } as any
      });

      if (!connection) {
        throw new NotFoundError("You are not following this member");
      }

      await this.connectionRepo.remove(connection);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "You have unfollowed this member successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/connections:
   *   get:
   *     summary: Get my connections (received or sent)
   *     tags: [Mobile Connection]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [SENT, RECEIVED, ALL]
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [PENDING, ACCEPTED, REJECTED, BLOCKED]
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/")
  async getMyConnections(
    @Req() req: any,
    @QueryParam("type") type: "SENT" | "RECEIVED" | "ALL",
    @QueryParam("status") status: ConnectionStatus,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    const userId = req.user.userId;
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = {};

      if (type === "SENT") {
        // SENT connection requests are where I initiated them.
        // In our model, my initiated request is stored as a pending record
        // where receiverId = myId and status = PENDING.
        where.receiverId = new ObjectId(userId);
        where.status = ConnectionStatus.PENDING;
      } else if (type === "RECEIVED") {
        // RECEIVED connection requests are where I need to accept them.
        // In our model, this is stored as a pending record
        // where senderId = myId and status = PENDING.
        where.senderId = new ObjectId(userId);
        where.status = ConnectionStatus.PENDING;
      } else {
        where.$or = [
          { senderId: new ObjectId(userId) },
          { receiverId: new ObjectId(userId) }
        ];

        if (status) {
          where.status = status;
        } else {
          where.status = { $ne: ConnectionStatus.CANCELLED };
        }
      }

      const [connections, total] = await this.connectionRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { updatedAt: "DESC" }
      });

      // Populate Member Details
      const memberIds = connections.map(c =>
        c.senderId.toString() === userId ? c.receiverId : c.senderId
      );

      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];
      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        businessType: m.businessType,
        legalName: m.legalName,
        city: m.city
      }]));

      const data = connections.map(c => {
        const otherMemberId = c.senderId.toString() === userId ? c.receiverId.toString() : c.senderId.toString();

        let direction = "SENT";
        if (c.status === ConnectionStatus.PENDING) {
          // In the PENDING connection request, the initiator is the receiverId.
          // So if receiverId is the logged-in user, the direction is SENT.
          direction = c.receiverId.toString() === userId ? "SENT" : "RECEIVED";
        } else {
          direction = c.senderId.toString() === userId ? "SENT" : "RECEIVED";
        }

        return {
          ...c,
          member: memberMap.get(otherMemberId) || null,
          direction
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/connections/relationship-list:
   *   get:
   *     summary: Get followers, following or mutual members
   *     tags: [Mobile Connection]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         required: true
   *         schema:
   *           type: string
   *           enum: [FOLLOWERS, FOLLOWING, MUTUAL, ALL]
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
  @Get("/relationship-list")
  async getRelationshipList(
    @Req() req: any,
    @QueryParam("type") type: "FOLLOWERS" | "FOLLOWING" | "MUTUAL" | "ALL",
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("category") category: string,
    @QueryParam("state") state: string,
    @QueryParam("region") region: string,
    @Res() res: any
  ) {
    const userId = req.user.userId;
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      let targetMemberIds: ObjectId[] = [];
      let total = 0;

      if (type === "FOLLOWING") {
        const followings = await this.connectionRepo.find({
          where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        targetMemberIds = followings.map(f => f.receiverId);
      }
      else if (type === "FOLLOWERS") {
        const followers = await this.connectionRepo.find({
          where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        targetMemberIds = followers.map(f => f.senderId);
      }
      else if (type === "MUTUAL") {
        // Mutual: Both followings and followers exist
        const followings = await this.connectionRepo.find({
          where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        const followingIds = new Set(followings.map(f => f.receiverId.toString()));

        const followers = await this.connectionRepo.find({
          where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });

        targetMemberIds = followers
          .filter(f => followingIds.has(f.senderId.toString()))
          .map(f => f.senderId);
      }
      else if (type === "ALL") {
        // All: combined, unique list of both followings and followers
        const followings = await this.connectionRepo.find({
          where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        const followingIds = followings.map(f => f.receiverId.toString());

        const followers = await this.connectionRepo.find({
          where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
        });
        const followerIds = followers.map(f => f.senderId.toString());

        targetMemberIds = Array.from(new Set([...followingIds, ...followerIds]))
          .map(id => new ObjectId(id));
      }

      if (targetMemberIds.length === 0) {
        return pagination(0, [], limit, page, res);
      }

      // Build filter for Member repository
      const memberWhere: any = {
        _id: { $in: targetMemberIds },
        isDeleted: false,
        status: MemberStatus.ACTIVE
      };

      if (search) {
        memberWhere.$or = [
          { fullName: { $regex: search, $options: "i" } },
          { businessName: { $regex: search, $options: "i" } },
          { city: { $regex: search, $options: "i" } }
        ];
      }

      if (category) {
        memberWhere.businessCategory = new ObjectId(category);
      }

      if (state) {
        memberWhere.state = state;
      }

      if (region && ObjectId.isValid(region)) {
        memberWhere.businessRegion = new ObjectId(region);
      }

      // Fetch Paginated Member Details applying filters
      const [members, filteredCount] = await this.memberRepo.findAndCount({
        where: memberWhere,
        skip: page * limit,
        take: limit,
        order: { fullName: "ASC" }
      });
      total = filteredCount;

      const paginatedMemberIds = members.map(m => m._id);

      // Fetch only outgoing connections to these specific members to determine follow-back status
      const myOutgoingConnections = paginatedMemberIds.length > 0
        ? await this.connectionRepo.find({
          where: {
            senderId: new ObjectId(userId),
            receiverId: { $in: paginatedMemberIds }
          } as any
        })
        : [];
      const outgoingMap = new Map(myOutgoingConnections.map(c => [c.receiverId.toString(), c.status]));

      // Map data
      const data = members.map(m => {
        return {
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto,
          businessName: m.businessName,
          businessType: m.businessType,
          legalName: m.legalName,
          city: m.city,
          status: outgoingMap.get(m._id.toString()) === "ACCEPTED"
            ? "Following"
            : outgoingMap.get(m._id.toString()) === "PENDING"
              ? "Requested"
              : "Follow back"
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/connections/{id}/status:
   *   put:
   *     summary: Accept or Reject a connection request
   *     tags: [Mobile Connection]
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
   *             $ref: '#/components/schemas/UpdateConnectionStatusDto'
   */
  @Put("/:id/status")
  async updateStatus(
    @Req() req: any,
    @Param("id") id: string,
    @Body() data: UpdateConnectionStatusDto,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const connection = await this.connectionRepo.findOneBy({ _id: new ObjectId(id) });
      if (!connection) throw new NotFoundError("Connection request not found");

      // Permission Logic
      if (data.status === ConnectionStatus.CANCELLED) {
        // Only the initiator (receiverId of the pending follow-back record) can cancel the request
        if (connection.receiverId.toString() !== userId) {
          throw new BadRequestError("Only the initiator can cancel this connection request");
        }
      } else {
        // Only the requested person (senderId of the pending follow-back record) can accept/reject/block
        if (connection.senderId.toString() !== userId) {
          throw new BadRequestError("You are not authorized to update this connection status");
        }
      }

      if (connection.status !== ConnectionStatus.PENDING && data.status !== ConnectionStatus.BLOCKED) {
        throw new BadRequestError(`Connection is already ${connection.status}`);
      }

      connection.status = data.status;
      const saved = await this.connectionRepo.save(connection);

      // ✅ Send Notification to original Sender (Initiator)
      if (data.status === ConnectionStatus.ACCEPTED || data.status === ConnectionStatus.REJECTED) {
        const initiator = await this.memberRepo.findOneBy({ _id: connection.receiverId, isDeleted: false });
        const requestedPerson = await this.memberRepo.findOneBy({ _id: connection.senderId, isDeleted: false });

        if (initiator?.fcmToken) {
          const statusText = data.status === ConnectionStatus.ACCEPTED ? "accepted" : "declined";
          const subjectText = data.status === ConnectionStatus.ACCEPTED ? "Connection Request Accepted" : "Connection Request Declined";

          await insertPushNotification({
            token: initiator.fcmToken,
            subject: subjectText,
            content: `${requestedPerson?.fullName || "A member"} has ${statusText} your connection request.`,
            moduleName: NotificationModule.CONNECTION,
            moduleId: saved._id.toString(),
            receiverId: connection.receiverId.toString(),
            senderId: userId
          });
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Connection ${data.status.toLowerCase()} successfully`,
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/connections/{id}:
   *   delete:
   *     summary: Remove or cancel a connection
   *     tags: [Mobile Connection]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Delete("/:id")
  async deleteConnection(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const connection = await this.connectionRepo.findOneBy({ _id: new ObjectId(id) });
      if (!connection) throw new NotFoundError("Connection not found");

      // Check if user is part of this connection
      if (connection.senderId.toString() !== userId && connection.receiverId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to remove this connection");
      }

      await this.connectionRepo.remove(connection);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Connection removed successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
