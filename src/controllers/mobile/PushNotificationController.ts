import { JsonController, Post, Body, Res, HttpCode } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { sendPushNotification, insertPushNotification } from "../../services/pushnotification.service";
import handleErrorResponse from "../../utils/commonFunction";
import { InsertPushNotificationDto } from "../../dto/mobile/InsertPushNotification.dto";

@JsonController("/push-notification")
export class PushNotificationController {

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
}
