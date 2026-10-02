import {
  JsonController,
  Get,
  Post,
  Req,
  Res,
  HttpCode,
  UseBefore
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { chatgptOAuthService } from "../../services/chatgptOAuth.service";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/chatgpt")
@UseBefore(MobileAuthMiddleware)
export class MobileChatGptController {

  /**
   * @swagger
   * /mobile-api/chatgpt/connect:
   *   get:
   *     summary: Generate connection URL for ChatGPT OAuth onboarding
   *     tags: [Mobile ChatGPT]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Connection URL generated successfully
   */
  @Get("/connect")
  @HttpCode(StatusCodes.OK)
  async connect(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId || req.user.id;
      const redirectUri = (req.query?.redirect_uri as string) || undefined;
      const gptId = (req.query?.gpt_id as string) || undefined;
      const clientId = (req.query?.client_id as string) || undefined;

      const url = await chatgptOAuthService.generateConnectionUrl(memberId, {
        clientId,
        redirectUri: redirectUri || (gptId ? `https://chatgpt.com/aip/${gptId}/oauth/callback` : undefined)
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          url
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chatgpt/status:
   *   get:
   *     summary: Check if the current member has connected ChatGPT
   *     tags: [Mobile ChatGPT]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Connection status retrieved successfully
   */
  @Get("/status")
  @HttpCode(StatusCodes.OK)
  async getStatus(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId || req.user.id;
      const status = await chatgptOAuthService.getConnectionStatus(memberId);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          connected: status.connected,
          scopes: status.scopes
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/chatgpt/disconnect:
   *   post:
   *     summary: Disconnect ChatGPT integration and revoke tokens
   *     tags: [Mobile ChatGPT]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: ChatGPT disconnected successfully
   */
  @Post("/disconnect")
  @HttpCode(StatusCodes.OK)
  async disconnect(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId || req.user.id;
      await chatgptOAuthService.disconnect(memberId);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "ChatGPT connection disconnected successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
