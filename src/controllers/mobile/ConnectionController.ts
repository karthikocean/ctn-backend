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
import { Member } from "../../entity/Member";
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
   *             type: object
   *             properties:
   *               receiverId:
   *                 type: string
   *                 example: "60d5ecb8b392d7001f8e8e3a"
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

      const connection = new Connection();
      connection.senderId = new ObjectId(senderId);
      connection.receiverId = new ObjectId(receiverId);
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
        where.senderId = new ObjectId(userId);
      } else if (type === "RECEIVED") {
        where.receiverId = new ObjectId(userId);
      } else {
        where.$or = [
          { senderId: new ObjectId(userId) },
          { receiverId: new ObjectId(userId) }
        ];
      }

      if (status) {
        where.status = status;
      } else {
        where.status = { $ne: ConnectionStatus.CANCELLED };
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
        city: m.city
      }]));

      const data = connections.map(c => {
        const otherMemberId = c.senderId.toString() === userId ? c.receiverId.toString() : c.senderId.toString();
        return {
          ...c,
          member: memberMap.get(otherMemberId) || null,
          direction: c.senderId.toString() === userId ? "SENT" : "RECEIVED"
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
   *           enum: [FOLLOWERS, FOLLOWING, MUTUAL]
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   */
  @Get("/relationship-list")
  async getRelationshipList(
    @Req() req: any,
    @QueryParam("type") type: "FOLLOWERS" | "FOLLOWING" | "MUTUAL",
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    const userId = req.user.userId;
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      let targetMemberIds: ObjectId[] = [];
      let total = 0;

      if (type === "FOLLOWING") {
        const [followings, count] = await this.connectionRepo.findAndCount({
          where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED },
          skip: page * limit,
          take: limit
        });
        targetMemberIds = followings.map(f => f.receiverId);
        total = count;
      }
      else if (type === "FOLLOWERS") {
        const [followers, count] = await this.connectionRepo.findAndCount({
          where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED },
          skip: page * limit,
          take: limit
        });
        targetMemberIds = followers.map(f => f.senderId);
        total = count;
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

        const mutualIds = followers
          .filter(f => followingIds.has(f.senderId.toString()))
          .map(f => f.senderId);

        total = mutualIds.length;
        targetMemberIds = mutualIds.slice(page * limit, (page + 1) * limit);
      }

      if (targetMemberIds.length === 0) {
        return pagination(total, [], limit, page, res);
      }

      // Fetch Member Details
      const members = await this.memberRepo.find({
        where: { _id: { $in: targetMemberIds } } as any
      });

      // Fetch ALL my outgoing connections to these members to determine follow-back status
      const myOutgoingConnections = await this.connectionRepo.find({
        where: {
          senderId: new ObjectId(userId),
          receiverId: { $in: targetMemberIds }
        } as any
      });
      const outgoingMap = new Map(myOutgoingConnections.map(c => [c.receiverId.toString(), c.status]));

      // Maintain order and map data
      const data = targetMemberIds.map(id => {
        const m = members.find(member => member._id.toString() === id.toString());
        if (!m) return null;

        return {
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto,
          businessName: m.businessName,
          city: m.city,
          status: outgoingMap.get(m._id.toString()) === "ACCEPTED"
            ? "Following"
            : outgoingMap.get(m._id.toString()) === "PENDING"
              ? "Requested"
              : "Follow back"
        };
      }).filter(item => item !== null);

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
        if (connection.senderId.toString() !== userId) {
          throw new BadRequestError("Only the sender can cancel a connection request");
        }
      } else {
        // Only receiver can accept/reject/block a pending request
        if (connection.receiverId.toString() !== userId) {
          throw new BadRequestError("You are not authorized to update this connection status");
        }
      }

      if (connection.status !== ConnectionStatus.PENDING && data.status !== ConnectionStatus.BLOCKED) {
        throw new BadRequestError(`Connection is already ${connection.status}`);
      }

      connection.status = data.status;
      const saved = await this.connectionRepo.save(connection);

      // ✅ Send Notification to original Sender
      if (data.status === ConnectionStatus.ACCEPTED || data.status === ConnectionStatus.REJECTED) {
        const originalSender = await this.memberRepo.findOneBy({ _id: connection.senderId, isDeleted: false });
        const receiver = await this.memberRepo.findOneBy({ _id: connection.receiverId, isDeleted: false });

        if (originalSender?.fcmToken) {
          const statusText = data.status === ConnectionStatus.ACCEPTED ? "accepted" : "declined";
          const subjectText = data.status === ConnectionStatus.ACCEPTED ? "Connection Request Accepted" : "Connection Request Declined";

          await insertPushNotification({
            token: originalSender.fcmToken,
            subject: subjectText,
            content: `${receiver?.fullName || "A member"} has ${statusText} your connection request.`,
            moduleName: NotificationModule.CONNECTION,
            moduleId: saved._id.toString(),
            receiverId: connection.senderId.toString(),
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
