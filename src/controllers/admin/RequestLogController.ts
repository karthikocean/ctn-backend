import {
  JsonController,
  Get,
  Delete,
  QueryParam,
  UseBefore,
  Res
} from "routing-controllers";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { RequestLogService } from "../../services/requestLog.service";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { StatusCodes } from "http-status-codes";

@JsonController("/request-logs")
@UseBefore(AuthMiddleware)
export class RequestLogController {
  /**
   * @swagger
   * /api/admin/request-logs:
   *   get:
   *     summary: Get all stored request logs with filters and pagination
   *     tags: [Admin Request Logs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: userId
   *         schema:
   *           type: string
   *       - in: query
   *         name: method
   *         schema:
   *           type: string
   *       - in: query
   *         name: statusCode
   *         schema:
   *           type: integer
   *       - in: query
   *         name: path
   *         schema:
   *           type: string
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: ipAddress
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: List of request logs
   */
  @Get("/")
  async getLogs(
    @QueryParam("page") page: number = 0,
    @QueryParam("limit") limit: number = 20,
    @QueryParam("userId") userId?: string,
    @QueryParam("method") method?: string,
    @QueryParam("statusCode") statusCode?: number,
    @QueryParam("path") path?: string,
    @QueryParam("startDate") startDate?: string,
    @QueryParam("endDate") endDate?: string,
    @QueryParam("ipAddress") ipAddress?: string,
    @Res() res?: any
  ) {
    try {
      const result = await RequestLogService.getLogs({
        page,
        limit,
        userId,
        method,
        statusCode,
        path,
        startDate,
        endDate,
        ipAddress
      });

      return pagination(result.total, result.data, result.limit, result.page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/request-logs/stats:
   *   get:
   *     summary: Get summary statistics of stored request logs
   *     tags: [Admin Request Logs]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Log statistics
   */
  @Get("/stats")
  async getStats(@Res() res: any) {
    try {
      const stats = await RequestLogService.getStats();
      return res.status(StatusCodes.OK).json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/request-logs/cleanup:
   *   delete:
   *     summary: Trigger permanent deletion of expired request logs
   *     tags: [Admin Request Logs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: days
   *         description: Retention threshold in days (defaults to REQUEST_LOG_RETENTION_DAYS or 30)
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Deletion summary
   */
  @Delete("/cleanup")
  async cleanupExpired(
    @QueryParam("days") days?: number,
    @Res() res?: any
  ) {
    try {
      const result = await RequestLogService.cleanupExpiredLogs(days);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Successfully deleted ${result.deletedCount} expired request log(s) older than ${result.retentionDays} days.`,
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
