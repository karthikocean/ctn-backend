import {
  JsonController,
  Get,
  Put,
  Body,
  Res,
  Req,
  UseBefore,
  QueryParam
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import pagination from "../../utils/pagination";
import { AppDataSource } from "../../data-source";
import { PushNotification, NotificationModule } from "../../entity/PushNotifications";
import { Member } from "../../entity/Member";
import { ObjectId } from "mongodb";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";

@JsonController("/push-notification")
export class AdminPushNotificationController {
  private pushNotificationRepo = AppDataSource.getMongoRepository(PushNotification);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/admin/push-notification/unread-count:
   *   get:
   *     summary: Get unread count of notifications for admin
   *     tags: [Admin Push Notification]
   */
  @Get("/unread-count")
  @UseBefore(AuthMiddleware)
  async getUnreadCount(@Req() req: any, @Res() res: any) {
    try {
      const rawId = req.user?.userId || req.user?._id || req.user?.id;
      const adminUserId = rawId && ObjectId.isValid(rawId) ? new ObjectId(rawId) : null;

      const query: any = {
        isRead: false,
        isDeleted: false
      };

      const orConditions = [
        ...(adminUserId ? [{ receiverId: adminUserId }] : []),
        { moduleName: NotificationModule.SUGGESTION }
      ];

      if (orConditions.length > 0) {
        query.$or = orConditions;
      }

      const count = await this.pushNotificationRepo.countDocuments(query);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          unreadCount: count
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/push-notification/details:
   *   get:
   *     summary: Get notifications for admin
   *     tags: [Admin Push Notification]
   */
  @Get("/details")
  @UseBefore(AuthMiddleware)
  async getDetails(
    @Req() req: any,
    @QueryParam("moduleName") moduleName: string,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      const rawId = req.user?.userId || req.user?._id || req.user?.id;
      const adminUserId = rawId && ObjectId.isValid(rawId) ? new ObjectId(rawId) : null;
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        $or: [
          ...(adminUserId ? [{ receiverId: adminUserId }] : []),
          { moduleName: NotificationModule.SUGGESTION }
        ],
        isDeleted: false
      };

      if (moduleName) {
        where.moduleName = moduleName;
      }

      const [notifications, total] = await this.pushNotificationRepo.findAndCount({
        where,
        order: { createdAt: "DESC" },
        take: limit,
        skip: page * limit
      });

      // Collect unique senderIds
      const senderIds = [
        ...new Set(
          notifications
            .filter((n) => n.senderId)
            .map((n) => n.senderId!.toString())
        )
      ];

      // Fetch sender members in one query
      let senderMap: Record<
        string,
        { fullName: string; mobileNumber: string; profilePhoto?: string }
      > = {};
      if (senderIds.length > 0) {
        const senderObjectIds = senderIds.map((id) => new ObjectId(id));
        const senders = await this.memberRepo.find({
          where: { _id: { $in: senderObjectIds } as any }
        });
        senders.forEach((s) => {
          senderMap[s._id.toString()] = {
            fullName: s.fullName,
            mobileNumber: s.mobileNumber,
            profilePhoto: s.profilePhoto
          };
        });
      }

      const enrichedNotifications = notifications.map((n) => ({
        ...n,
        sender: n.senderId ? senderMap[n.senderId.toString()] ?? null : null
      }));

      return pagination(total, enrichedNotifications, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/push-notification/read-all:
   *   put:
   *     summary: Mark all notifications as read for admin
   *     tags: [Admin Push Notification]
   */
  @Put("/read-all")
  @UseBefore(AuthMiddleware)
  async readAll(@Req() req: any, @Res() res: any) {
    try {
      const adminUserId = req.user?._id ? new ObjectId(req.user._id) : (req.user?.id ? new ObjectId(req.user.id) : null);

      await this.pushNotificationRepo.updateMany(
        {
          $or: [
            ...(adminUserId ? [{ receiverId: adminUserId }] : []),
            { moduleName: NotificationModule.SUGGESTION }
          ],
          isRead: false,
          isDeleted: false
        } as any,
        { $set: { isRead: true } } as any
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "All notifications marked as read successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/push-notification/read:
   *   put:
   *     summary: Mark specific notifications as read for admin
   *     tags: [Admin Push Notification]
   */
  @Put("/read")
  @UseBefore(AuthMiddleware)
  async markAsRead(
    @Req() req: any,
    @Body() body: { notificationIds?: string[]; moduleName?: string },
    @Res() res: any
  ) {
    try {
      const { notificationIds, moduleName } = body;

      if (notificationIds && notificationIds.length > 0) {
        const objectIds = notificationIds.map((id) => new ObjectId(id));
        await this.pushNotificationRepo.updateMany(
          { _id: { $in: objectIds } as any },
          { $set: { isRead: true } } as any
        );
      } else if (moduleName) {
        await this.pushNotificationRepo.updateMany(
          { moduleName: moduleName as any, isRead: false },
          { $set: { isRead: true } } as any
        );
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Marked as read successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
