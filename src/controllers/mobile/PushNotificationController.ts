import { JsonController, Post, Get, Put, Body, Res, Req, HttpCode, UseBefore, QueryParam } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { sendPushNotification, insertPushNotification } from "../../services/pushnotification.service";
import handleErrorResponse from "../../utils/commonFunction";
import { pagination } from "../../utils";
import { InsertPushNotificationDto } from "../../dto/mobile/InsertPushNotification.dto";
import { AppDataSource } from "../../data-source";
import { PushNotification, NotificationModule } from "../../entity/PushNotifications";
import { ObjectId } from "mongodb";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";

@JsonController("/push-notification")
export class PushNotificationController {
  private pushNotificationRepo = AppDataSource.getMongoRepository(PushNotification);

  /**
   * @swagger
   * /mobile-api/push-notification/test-direct:
   *   post:
   *     summary: Send a test push notification directly (without saving to DB)
   *     tags: [Push Notification Test]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - token
   *               - title
   *               - body
   *             properties:
   *               token:
   *                 type: string
   *                 example: "fcm_device_token"
   *               title:
   *                 type: string
   *                 example: "Test Notification"
   *               body:
   *                 type: string
   *                 example: "This is a direct test notification"
   *               moduleName:
   *                 type: string
   *                 example: "GENERAL"
   *               moduleId:
   *                 type: string
   *                 example: "65e8a4c5f7c12d001245abc"
   *     responses:
   *       200:
   *         description: Notification sent successfully
   */
  @Post("/test-direct")
  @HttpCode(StatusCodes.OK)
  async testDirect(@Body() body: any, @Res() res: any) {
    try {
      const { token, title, body: content, moduleName, moduleId } = body;

      if (!token) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "FCM token is required"
        });
      }

      const input = {
        content: content || "Test Content",
        moduleName: moduleName || "GENERAL",
        moduleId: moduleId || ""
      };

      const result = await sendPushNotification(token, title || "Test Title", input);

      if (result) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Push notification sent successfully",
          result
        });
      } else {
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to send push notification"
        });
      }
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/push-notification/test-db:
   *   post:
   *     summary: Send a test push notification and save to DB
   *     tags: [Push Notification Test]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/InsertPushNotificationDto'
   *     responses:
   *       200:
   *         description: Notification saved and sent successfully
   */
  @Post("/test-db")
  @HttpCode(StatusCodes.OK)
  async testDb(@Body() body: InsertPushNotificationDto, @Res() res: any) {
    try {
      const result = await insertPushNotification(body);

      if (result) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Push notification saved and sent successfully"
        });
      } else {
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to save or send push notification"
        });
      }
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/push-notification/groups:
   *   get:
   *     summary: Get push notifications grouped by categories with unread counts
   *     tags: [Push Notification]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Grouped notifications
   */
  @Get("/groups")
  @UseBefore(MobileAuthMiddleware)
  async getGroups(@Req() req: any, @Res() res: any) {
    try {
      const userId = new ObjectId(req.user._id);

      // Fetch unread notifications for the user
      const unreadNotifications = await this.pushNotificationRepo.find({
        where: { receiverId: userId, isRead: false, isDeleted: false }
      });

      // Helper to count unread for specific modules
      const getCount = (modules: NotificationModule[]) => {
        return unreadNotifications.filter(n => modules.includes(n.moduleName)).length;
      };

      const result = {
        Networking: {
          totalUnread: getCount([
            NotificationModule.ONE_TO_ONE,
            NotificationModule.THANK_YOU_SLIP,
            NotificationModule.FOLLOW_REQUEST,
            NotificationModule.CONNECTION, // mapped to follow request
            NotificationModule.REFERRAL,
            NotificationModule.SPOTLIGHT
          ]),
          items: [
            { module: NotificationModule.ONE_TO_ONE, label: "One-to-One", unreadCount: getCount([NotificationModule.ONE_TO_ONE]) },
            { module: NotificationModule.THANK_YOU_SLIP, label: "Thank You Slips", unreadCount: getCount([NotificationModule.THANK_YOU_SLIP]) },
            { module: NotificationModule.FOLLOW_REQUEST, label: "Follow Requests", unreadCount: getCount([NotificationModule.FOLLOW_REQUEST, NotificationModule.CONNECTION]) },
            { module: NotificationModule.REFERRAL, label: "Referrals", unreadCount: getCount([NotificationModule.REFERRAL]) },
            { module: NotificationModule.SPOTLIGHT, label: "Spotlight", unreadCount: getCount([NotificationModule.SPOTLIGHT]) },
          ]
        },
        Communication: {
          totalUnread: getCount([
            NotificationModule.MESSAGE,
            NotificationModule.CHAT, // mapped to messages
            NotificationModule.MESSAGE_REQUEST
          ]),
          items: [
            { module: NotificationModule.MESSAGE, label: "Messages", unreadCount: getCount([NotificationModule.MESSAGE, NotificationModule.CHAT]) },
            { module: NotificationModule.MESSAGE_REQUEST, label: "Message Requests", unreadCount: getCount([NotificationModule.MESSAGE_REQUEST]) },
          ]
        },
        Posts: {
          totalUnread: getCount([NotificationModule.ASK, NotificationModule.GIVE, NotificationModule.REQUIREMENT]),
          items: [
            { module: NotificationModule.ASK, label: "Ask", unreadCount: getCount([NotificationModule.ASK]) },
            { module: NotificationModule.GIVE, label: "Give", unreadCount: getCount([NotificationModule.GIVE]) },
            { module: NotificationModule.REQUIREMENT, label: "Requirements", unreadCount: getCount([NotificationModule.REQUIREMENT]) },
          ]
        },
        Announcements: {
          totalUnread: getCount([NotificationModule.EVENT, NotificationModule.TRAINING]),
          items: [
            { module: NotificationModule.EVENT, label: "Events", unreadCount: getCount([NotificationModule.EVENT]) },
            { module: NotificationModule.TRAINING, label: "Training", unreadCount: getCount([NotificationModule.TRAINING]) },
          ]
        },
        Membership: {
          totalUnread: getCount([NotificationModule.PLAN_EXPIRY, NotificationModule.UPGRADE, NotificationModule.DOWNGRADE]),
          items: [
            { module: NotificationModule.PLAN_EXPIRY, label: "Plan Expiry", unreadCount: getCount([NotificationModule.PLAN_EXPIRY]) },
            { module: NotificationModule.UPGRADE, label: "Upgrade", unreadCount: getCount([NotificationModule.UPGRADE]) },
            { module: NotificationModule.DOWNGRADE, label: "Downgrade", unreadCount: getCount([NotificationModule.DOWNGRADE]) },
          ]
        },
        Reminders: {
          totalUnread: getCount([NotificationModule.DAILY_TASK, NotificationModule.REMINDER]),
          items: [
            { module: NotificationModule.DAILY_TASK, label: "Daily Tasks", unreadCount: getCount([NotificationModule.DAILY_TASK]) },
            { module: NotificationModule.REMINDER, label: "Reminder", unreadCount: getCount([NotificationModule.REMINDER]) },
          ]
        }
      };

      return res.status(StatusCodes.OK).json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/push-notification/details:
   *   get:
   *     summary: Get notifications for a specific module
   *     tags: [Push Notification]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: moduleName
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: List of notifications
   */
  @Get("/details")
  @UseBefore(MobileAuthMiddleware)
  async getDetails(
    @Req() req: any,
    @QueryParam("moduleName") moduleName: string,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      if (!moduleName) {
        return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "moduleName is required" });
      }

      const userId = new ObjectId(req.user._id);
      page = Number(page) || 0;
      limit = Number(limit) || 20;

      // Handle mapped enums so older notifications still show up
      const targetModules = [moduleName as NotificationModule];
      if (moduleName === NotificationModule.FOLLOW_REQUEST) targetModules.push(NotificationModule.CONNECTION);
      if (moduleName === NotificationModule.MESSAGE) targetModules.push(NotificationModule.CHAT);

      const [notifications, total] = await this.pushNotificationRepo.findAndCount({
        where: {
          receiverId: userId,
          moduleName: { $in: targetModules } as any,
          isDeleted: false
        },
        order: { createdAt: "DESC" },
        take: limit,
        skip: page * limit
      });

      return pagination(total, notifications, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/push-notification/read:
   *   put:
   *     summary: Mark notifications as read
   *     tags: [Push Notification]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               notificationIds:
   *                 type: array
   *                 items:
   *                   type: string
   *               moduleName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Notifications marked as read
   */
  @Put("/read")
  @UseBefore(MobileAuthMiddleware)
  async markAsRead(@Req() req: any, @Body() body: { notificationIds?: string[], moduleName?: string }, @Res() res: any) {
    try {
      const userId = new ObjectId(req.user._id);
      const { notificationIds, moduleName } = body;

      if (notificationIds && notificationIds.length > 0) {
        const ids = notificationIds.map(id => new ObjectId(id));
        await this.pushNotificationRepo.update(
          { _id: { $in: ids } as any, receiverId: userId },
          { isRead: true }
        );
      } else if (moduleName) {
        const targetModules = [moduleName as NotificationModule];
        if (moduleName === NotificationModule.FOLLOW_REQUEST) targetModules.push(NotificationModule.CONNECTION);
        if (moduleName === NotificationModule.MESSAGE) targetModules.push(NotificationModule.CHAT);

        await this.pushNotificationRepo.update(
          { moduleName: { $in: targetModules } as any, receiverId: userId, isRead: false },
          { isRead: true }
        );
      } else {
        return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Provide notificationIds or moduleName" });
      }

      return res.status(StatusCodes.OK).json({ success: true, message: "Marked as read successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
