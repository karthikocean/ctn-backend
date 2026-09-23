import {
  JsonController,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  Req,
  Res,
  UseBefore,
  HttpCode
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { LeadGenerationService } from "../../modules/leadGeneration/services/leadGeneration.service";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/lead-generation")
@UseBefore(MobileAuthMiddleware)
export class LeadGenerationController {
  /**
   * @swagger
   * /mobile-api/lead-generation:
   *   post:
   *     summary: Create an AI lead generation request
   *     tags: [Lead Generation]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - businessNames
   *               - locations
   *             properties:
   *               businessNames:
   *                 type: array
   *                 items:
   *                   type: string
   *                 example: ["Solar Panel Manufacturers", "Renewable Energy Contractors"]
   *               locations:
   *                 type: array
   *                 items:
   *                   type: string
   *                 example: ["Chennai", "Bangalore"]
   *               additionalRequirement:
   *                 type: string
   *                 example: "Looking for ISO certified vendors with more than 50 employees"
   *     responses:
   *       201:
   *         description: Lead generation initiated successfully
   *       400:
   *         description: Validation error
   *       429:
   *         description: Rate limit exceeded
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async createLeadGeneration(@Req() req: any, @Body() body: any, @Res() res: any) {
    try {
      const userId = req.user.userId || req.user.id;
      const result = await LeadGenerationService.createLeadGeneration(userId, body);
      return res.status(StatusCodes.CREATED).json({
        status: "success",
        message: "Lead generation request initiated successfully",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/lead-generation:
   *   get:
   *     summary: Get all lead generation requests for current user
   *     tags: [Lead Generation]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number (default 1)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Page size (default 10)
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *         description: Filter by status (PENDING, PROCESSING, COMPLETED, FAILED)
   *     responses:
   *       200:
   *         description: Paginated lead generation requests
   */
  @Get("/")
  async getLeadGenerations(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId || req.user.id;
      const result = await LeadGenerationService.getLeadGenerations(userId, {
        page,
        limit,
        status
      });
      return res.status(StatusCodes.OK).json({
        status: "success",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/lead-generation/{id}:
   *   get:
   *     summary: Get lead generation request details by ID
   *     tags: [Lead Generation]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Lead generation request details
   *       404:
   *         description: Not found
   *       403:
   *         description: Forbidden
   */
  @Get("/:id")
  async getLeadGenerationById(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const userId = req.user.userId || req.user.id;
      const result = await LeadGenerationService.getLeadGenerationById(userId, id);
      return res.status(StatusCodes.OK).json({
        status: "success",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/lead-generation/{id}/prompt:
   *   put:
   *     summary: Edit the prompt for a lead generation request
   *     tags: [Lead Generation]
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
   *             type: object
   *             required:
   *               - prompt
   *             properties:
   *               prompt:
   *                 type: string
   *     responses:
   *       200:
   *         description: Prompt updated successfully
   *       409:
   *         description: Cannot edit while processing
   */
  @Put("/:id/prompt")
  async updatePrompt(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId || req.user.id;
      const result = await LeadGenerationService.updatePrompt(userId, id, body);
      return res.status(StatusCodes.OK).json({
        status: "success",
        message: "Prompt updated successfully",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/lead-generation/{id}/regenerate:
   *   post:
   *     summary: Regenerate leads using previous parameters or updated prompt
   *     tags: [Lead Generation]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               prompt:
   *                 type: string
   *     responses:
   *       201:
   *         description: Regeneration initiated
   *       429:
   *         description: Rate limit exceeded
   */
  @Post("/:id/regenerate")
  @HttpCode(StatusCodes.CREATED)
  async regenerate(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId || req.user.id;
      const promptOverride = body?.prompt;
      const result = await LeadGenerationService.regenerate(userId, id, promptOverride);
      return res.status(StatusCodes.CREATED).json({
        status: "success",
        message: "Lead regeneration initiated successfully",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/lead-generation/{id}/leads:
   *   get:
   *     summary: Get generated leads for a generation request
   *     tags: [Lead Generation]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Paginated leads
   */
  @Get("/:id/leads")
  async getLeads(
    @Req() req: any,
    @Param("id") id: string,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId || req.user.id;
      const result = await LeadGenerationService.getLeads(userId, id, { page, limit });
      return res.status(StatusCodes.OK).json({
        status: "success",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/lead-generation/{id}:
   *   delete:
   *     summary: Delete a lead generation request and its leads
   *     tags: [Lead Generation]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Lead generation deleted successfully
   */
  @Delete("/:id")
  async deleteLeadGeneration(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const userId = req.user.userId || req.user.id;
      const result = await LeadGenerationService.deleteLeadGeneration(userId, id);
      return res.status(StatusCodes.OK).json({
        status: "success",
        data: result
      });
    } catch (err: any) {
      return handleErrorResponse(err, res);
    }
  }
}
