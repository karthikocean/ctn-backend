import {
  JsonController,
  Get,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  BadRequestError,
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Suggestion, SuggestionStatus } from "../../entity/Suggestion";
import { UpdateSuggestionStatusDto } from "../../dto/mobile/Suggestion.dto";
import handleErrorResponse from "../../utils/commonFunction";
import pagination from "../../utils/pagination";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";

/**
 * @swagger
 * tags:
 *   name: Admin Suggestions
 *   description: Admin APIs for managing member suggestions
 */

@JsonController("/suggestions")
export class AdminSuggestionController {
  private suggestionRepo = AppDataSource.getMongoRepository(Suggestion);

  /**
   * @swagger
   * /api/admin/suggestions:
   *   get:
   *     summary: Get all suggestions with member details
   *     tags: [Admin Suggestions]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 0
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [PENDING, REVIEWED, RESOLVED, REJECTED]
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search by title or description
   */
  @Get("/")
  async getAllSuggestions(
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("status") status: string,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    try {
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(100, Number(limitParam) || 10);
      const skip = page * limit;

      const matchFilter: any = { isDeleted: false };

      if (status && Object.values(SuggestionStatus).includes(status as SuggestionStatus)) {
        matchFilter.status = status;
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        matchFilter.$or = [
          { title: { $regex: regex } },
          { description: { $regex: regex } }
        ];
      }

      const [suggestions, total] = await Promise.all([
        this.suggestionRepo.aggregate([
          { $match: matchFilter },
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "members",
              localField: "memberId",
              foreignField: "_id",
              as: "member"
            }
          },
          {
            $unwind: { path: "$member", preserveNullAndEmptyArrays: true }
          },
          {
            $project: {
              title: 1,
              description: 1,
              image: 1,
              status: 1,
              adminNote: 1,
              createdAt: 1,
              updatedAt: 1,
              member: {
                _id: "$member._id",
                fullName: "$member.fullName",
                mobileNumber: "$member.mobileNumber",
                email: "$member.email",
                profile: "$member.profilePhoto"
              }
            }
          }
        ]).toArray(),
        this.suggestionRepo.count({ where: matchFilter })
      ]);

      return pagination(total, suggestions, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/suggestions/{id}:
   *   get:
   *     summary: Get a single suggestion with member details
   *     tags: [Admin Suggestions]
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
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const [suggestion] = await this.suggestionRepo.aggregate([
        { $match: { _id: new ObjectId(id), isDeleted: false } },
        {
          $lookup: {
            from: "members",
            localField: "memberId",
            foreignField: "_id",
            as: "member"
          }
        },
        { $unwind: { path: "$member", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            title: 1,
            description: 1,
            image: 1,
            status: 1,
            adminNote: 1,
            createdAt: 1,
            updatedAt: 1,
            member: {
              _id: "$member._id",
              fullName: "$member.fullName",
              mobileNumber: "$member.mobileNumber",
              email: "$member.email",
              profile: "$member.profile"
            }
          }
        }
      ]).toArray();

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
   * /api/admin/suggestions/{id}/status:
   *   put:
   *     summary: Update suggestion status and admin note
   *     tags: [Admin Suggestions]
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
   *               - status
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [PENDING, REVIEWED, RESOLVED, REJECTED]
   *               adminNote:
   *                 type: string
   *                 maxLength: 500
   */
  @Put("/:id/status")
  async updateSuggestionStatus(
    @Param("id") id: string,
    @Body() body: UpdateSuggestionStatusDto,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      if (!Object.values(SuggestionStatus).includes(body.status as SuggestionStatus)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: `Invalid status. Allowed: ${Object.values(SuggestionStatus).join(", ")}`
        });
      }

      const suggestion = await this.suggestionRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false } as any
      });

      if (!suggestion) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Suggestion not found"
        });
      }

      const updateFields: any = { status: body.status };
      if (body.adminNote !== undefined) updateFields.adminNote = body.adminNote.trim();

      await this.suggestionRepo.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Suggestion status updated successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/suggestions/{id}:
   *   delete:
   *     summary: Hard delete a suggestion
   *     tags: [Admin Suggestions]
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
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const suggestion = await this.suggestionRepo.findOne({
        where: { _id: new ObjectId(id) } as any
      });

      if (!suggestion) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Suggestion not found"
        });
      }

      await this.suggestionRepo.deleteOne({ _id: new ObjectId(id) });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Suggestion deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
