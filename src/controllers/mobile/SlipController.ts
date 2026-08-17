import {
  JsonController,
  Put,
  Body,
  Req,
  Res,
  UseBefore,
  HttpCode
} from "routing-controllers";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { UpdateSlipStatusDto } from "../../dto/mobile/Slip.dto";
import { SlipService } from "../../services/slip.service";
import { StatusCodes } from "http-status-codes";

/**
 * @swagger
 * tags:
 *   name: Slips
 *   description: Unified status update API for Direct Meet, Recommendations, and Business Done
 */

@JsonController("/slips")
@UseBefore(MobileAuthMiddleware)
export class SlipController {
  private slipService = new SlipService();

  /**
   * @swagger
   * /mobile-api/slips/status:
   *   put:
   *     summary: Update status for Direct Meet, Recommendations, or Business Done in a single API
   *     tags: [Slips]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateSlipStatusDto'
   *     responses:
   *       200:
   *         description: Status updated successfully
   *       400:
   *         description: Invalid input or missing ID/status
   *       404:
   *         description: Slip record not found
   */
  @Put("/status")
  @HttpCode(StatusCodes.OK)
  async updateStatus(
    @Req() req: any,
    @Body() body: UpdateSlipStatusDto,
    @Res() res: any
  ) {
    try {
      const currentUserId = req.user?.userId;
      const result = await this.slipService.updateStatus({
        id: body.id!,
        status: body.status,
        reason: body.reason,
        type: body.type,
        currentUserId
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `${result.type} status updated successfully`,
        data: result
      });
    } catch (error: any) {
      const statusCode = error.httpCode || error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
      return res.status(statusCode).json({
        success: false,
        message: error.message || "Failed to update slip status"
      });
    }
  }
}
