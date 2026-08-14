import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  QueryParams,
  Req,
  Res,
  UseBefore
} from "routing-controllers";
import { CreateReminderDto } from "../../dto/mobile/CreateReminderDto";
import { UpdateReminderDto } from "../../dto/mobile/UpdateReminderDto";
import { ReminderListDto } from "../../dto/mobile/ReminderListDto";
import { ReminderService } from "../../services/ReminderService";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import pagination from "../../utils/pagination";
import { StatusCodes } from "http-status-codes";

@JsonController("/reminder")
@UseBefore(MobileAuthMiddleware)
export class ReminderController {
  private reminderService = new ReminderService();

  /**
   * @swagger
   * /mobile-api/reminder:
   *   post:
   *     summary: Create a new reminder
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateReminderDto'
   *     responses:
   *       201:
   *         description: Reminder created successfully
   */
  @Post("/")
  async create(@Req() req: any, @Body() data: CreateReminderDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const reminder = await this.reminderService.createReminder(data, userId);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Reminder created successfully",
        data: reminder
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/reminder/{id}:
   *   put:
   *     summary: Update an existing reminder
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Reminder ObjectId
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateReminderDto'
   *     responses:
   *       200:
   *         description: Reminder updated successfully
   */
  @Put("/:id")
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() data: UpdateReminderDto,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId;
      const reminder = await this.reminderService.updateReminder(id, data, userId);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Reminder updated successfully",
        data: reminder
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/reminder/{id}:
   *   delete:
   *     summary: Soft delete a reminder
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Reminder ObjectId
   *     responses:
   *       200:
   *         description: Reminder deleted successfully
   */
  @Delete("/:id")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const userId = req.user.userId;
      await this.reminderService.deleteReminder(id, userId);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Reminder deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/reminder/{id}:
   *   get:
   *     summary: Get details of a reminder
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Reminder ObjectId
   *     responses:
   *       200:
   *         description: Reminder retrieved successfully
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      const reminder = await this.reminderService.getReminder(id);
      return res.status(StatusCodes.OK).json({
        success: true,
        data: reminder
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/reminder:
   *   get:
   *     summary: Get paginated filtered list of reminders
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number (0-indexed)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Number of records per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search query matching title or description
   *       - in: query
   *         name: module
   *         schema:
   *           type: string
   *         description: Filter by module name (e.g. EVENT, TASK)
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *         description: Filter by status (Pending, Completed, Cancelled)
   *       - in: query
   *         name: fromDate
   *         schema:
   *           type: string
   *         description: Start date filter (ISO format)
   *       - in: query
   *         name: toDate
   *         schema:
   *           type: string
   *         description: End date filter (ISO format)
   *       - in: query
   *         name: isActive
   *         schema:
   *           type: boolean
   *         description: Filter by active status
   *     responses:
   *       200:
   *         description: List of reminders retrieved successfully
   */
  @Get("/")
  async getAll(@Req() req: any, @QueryParams() filters: ReminderListDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const { total, data } = await this.reminderService.getReminderList(filters, userId);
      const page = Number(filters.page) || 0;
      const limit = Number(filters.limit) || 10;
      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/reminder/{id}/status:
   *   patch:
   *     summary: Toggle reminder active status
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Reminder ObjectId
   *     responses:
   *       200:
   *         description: Status toggled successfully
   */
  @Patch("/:id/status")
  async toggleStatus(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const reminder = await this.reminderService.toggleReminder(id, userId);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Reminder status toggled to ${reminder.isActive ? "active" : "inactive"}`,
        data: reminder
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/reminder/{id}/send:
   *   post:
   *     summary: Trigger manual notification trigger simulation
   *     tags: [Mobile Reminder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Reminder ObjectId
   *     responses:
   *       200:
   *         description: Reminder manual notification triggered successfully
   */
  @Post("/:id/send")
  async sendNow(@Param("id") id: string, @Res() res: any) {
    try {
      await this.reminderService.sendReminderNow(id);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Reminder notification triggered manually successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
