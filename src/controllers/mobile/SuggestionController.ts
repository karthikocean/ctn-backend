import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  Req,
  Res,
  UseBefore,
  BadRequestError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Suggestion, SuggestionStatus } from "../../entity/Suggestion";
import { CreateSuggestionDto, UpdateSuggestionDto } from "../../dto/mobile/Suggestion.dto";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { pagination } from "../../utils";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { notifyAdminOnSuggestion } from "../../services/pushnotification.service";
import imageService from "../../utils/upload";

/**
 * @swagger
 * tags:
 *   name: Mobile Suggestions
 *   description: Member suggestion / feedback APIs
 */

@JsonController("/suggestions")
@UseBefore(MobileAuthMiddleware)
export class MobileSuggestionController {
  private suggestionRepo = AppDataSource.getMongoRepository(Suggestion);

  /**
   * @swagger
   * /mobile-api/suggestions:
   *   post:
   *     summary: Submit a new suggestion or query
   *     tags: [Mobile Suggestions]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *               - description
   *             properties:
   *               title:
   *                 type: string
   *                 minLength: 3
   *                 maxLength: 150
   *                 example: "Suggestion Title"
   *               description:
   *                 type: string
   *                 minLength: 10
   *                 maxLength: 2000
   *                 example: "Detailed description of the suggestion"
   *               image:
   *                 type: string
   *                 example: "/suggestions/media-123456.jpg"
   */
  @Post("/")
  async createSuggestion(
    @Req() req: any,
    @Body() body: CreateSuggestionDto,
    @Res() res: any
  ) {
    try {
      const memberId = new ObjectId(req.user.userId);

      const suggestion = new Suggestion();
      suggestion.memberId = memberId;
      suggestion.title = body?.title?.trim();
      suggestion.description = body?.description?.trim();
      suggestion.image = body?.image;
      suggestion.status = SuggestionStatus.PENDING;
      suggestion.isDeleted = false;

      const saved = await this.suggestionRepo.save(suggestion);

      // Send Push Notification DB record and emit live socket notification to admin
      notifyAdminOnSuggestion({
        suggestionId: saved._id,
        title: saved.title,
        description: saved.description,
        memberId: saved.memberId
      }).catch(err => console.error("[createSuggestion] notifyAdminOnSuggestion error:", err));

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Suggestion submitted successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/suggestions:
   *   get:
   *     summary: Get my submitted suggestions
   *     tags: [Mobile Suggestions]
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
   *         name: status
   *         schema:
   *           type: string
   *           enum: [PENDING, REVIEWED, RESOLVED, REJECTED]
   */
  @Get("/")
  async getMySuggestions(
    @Req() req: any,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    try {
      const memberId = new ObjectId(req.user.userId);
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(50, Number(limitParam) || 10);

      const matchFilter: any = { memberId, isDeleted: false };
      if (status && Object.values(SuggestionStatus).includes(status as SuggestionStatus)) {
        matchFilter.status = status;
      }

      const [suggestions, total] = await Promise.all([
        this.suggestionRepo.find({
          where: matchFilter,
          order: { createdAt: "DESC" },
          skip: page * limit,
          take: limit
        }),
        this.suggestionRepo.count(matchFilter as any)
      ]);

      return pagination(total, suggestions, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/suggestions/{id}:
   *   get:
   *     summary: Get a specific suggestion by ID
   *     tags: [Mobile Suggestions]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/:id")
  async getSuggestionById(
    @Req() req: any,
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const memberId = new ObjectId(req.user.userId);
      const suggestion = await this.suggestionRepo.findOne({
        where: { _id: new ObjectId(id), memberId, isDeleted: false } as any
      });

      if (!suggestion) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Suggestion not found"
        });
      }

      return res.status(StatusCodes.OK).json({ success: true, data: suggestion });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/suggestions/{id}:
   *   put:
   *     summary: Edit a pending suggestion
   *     tags: [Mobile Suggestions]
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
   *             properties:
   *               title:
   *                 type: string
   *                 minLength: 3
   *                 maxLength: 150
   *               description:
   *                 type: string
   *                 minLength: 10
   *                 maxLength: 2000
   *               image:
   *                 type: string
   */
  @Put("/:id")
  async updateSuggestion(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: UpdateSuggestionDto,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const memberId = new ObjectId(req.user.userId);
      const suggestion = await this.suggestionRepo.findOne({
        where: { _id: new ObjectId(id), memberId, isDeleted: false } as any
      });

      if (!suggestion) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Suggestion not found"
        });
      }

      if (suggestion.status !== SuggestionStatus.PENDING) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "Only pending suggestions can be edited"
        });
      }

      const oldImage = suggestion.image;
      const updateFields: any = {};
      if (body.title !== undefined) updateFields.title = body.title.trim();
      if (body.description !== undefined) updateFields.description = body.description.trim();
      if (body.image !== undefined) updateFields.image = body.image;

      if (Object.keys(updateFields).length === 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "No fields provided to update"
        });
      }

      await this.suggestionRepo.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );

      // Clean up replaced S3 image
      if (body.image !== undefined) {
        imageService.cleanupReplacedFiles(oldImage, body.image);
      }

      const updated = await this.suggestionRepo.findOne({
        where: { _id: new ObjectId(id) } as any
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Suggestion updated successfully",
        data: updated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/suggestions/{id}:
   *   delete:
   *     summary: Delete (soft-delete) a suggestion
   *     tags: [Mobile Suggestions]
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
  async deleteSuggestion(
    @Req() req: any,
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const memberId = new ObjectId(req.user.userId);
      const suggestion = await this.suggestionRepo.findOne({
        where: { _id: new ObjectId(id), memberId, isDeleted: false } as any
      });

      if (!suggestion) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Suggestion not found"
        });
      }

      if (suggestion.status !== SuggestionStatus.PENDING) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "Only pending suggestions can be deleted"
        });
      }

      await this.suggestionRepo.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isDeleted: true } }
      );

      // Clean up S3 image
      if (suggestion.image) {
        await imageService.cleanupFiles(suggestion.image);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Suggestion deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
