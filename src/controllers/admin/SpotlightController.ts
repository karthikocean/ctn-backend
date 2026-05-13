import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Spotlight } from "../../entity/Spotlight";
import { Member } from "../../entity/Member";
import { CreateSpotlightDto, UpdateSpotlightDto } from "../../dto/admin/Spotlight.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/spotlights")
@UseBefore(AuthMiddleware)
export class SpotlightController {
  private spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /api/admin/spotlights:
   *   post:
   *     summary: Create a new spotlight schedule
   *     tags: [Spotlight]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSpotlightDto'
   *     responses:
   *       201:
   *         description: Spotlight scheduled successfully
   */
  @Post("/")
  @UseBefore(canAccess("spotlight", "add"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateSpotlightDto, @Res() res: any) {
    try {
      const spotlight = new Spotlight();
      spotlight.members = data.members.map(id => new ObjectId(id));
      spotlight.scheduleDate = new Date(data.scheduleDate);
      spotlight.status = data.status || spotlight.status;
      spotlight.isDeleted = false;

      const saved = await this.spotlightRepo.save(spotlight);
      return res.status(StatusCodes.CREATED).json({
        message: "Spotlight scheduled successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights:
   *   get:
   *     summary: Get all spotlight schedules with pagination and search
   *     tags: [Spotlight]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: status
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: List of spotlight schedules
   */
  @Get("/")
  @UseBefore(canAccess("spotlight", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("status") status: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (status) {
        where.status = status;
      }

      const [spotlights, total] = await this.spotlightRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { scheduleDate: "DESC" }
      });

      // Fetch member details for the response
      const allMemberIds = spotlights.reduce((acc: ObjectId[], s) => {
        return [...acc, ...s.members];
      }, []);
      
      const uniqueMemberIds = Array.from(new Set(allMemberIds.map(id => id.toString()))).map(id => new ObjectId(id));
      
      const members = await this.memberRepo.find({
        where: { _id: { $in: uniqueMemberIds } }
      });

      const memberMap = members.reduce((acc: any, m) => {
        acc[m._id.toString()] = { _id: m._id, fullName: m.fullName };
        return acc;
      }, {});

      const spotlightsWithMembers = spotlights.map(s => ({
        ...s,
        members: s.members.map(id => memberMap[id.toString()] || { _id: id, fullName: "Unknown Member" })
      }));

      return pagination(total, spotlightsWithMembers, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/{id}:
   *   get:
   *     summary: Get a single spotlight by ID
   *     tags: [Spotlight]
   */
  @Get("/:id")
  @UseBefore(canAccess("spotlight", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const spotlight = await this.spotlightRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!spotlight) throw new NotFoundError("Spotlight not found");

      // Fetch member details
      const members = await this.memberRepo.find({
        where: { _id: { $in: spotlight.members } }
      });

      const spotlightWithMembers = {
        ...spotlight,
        members: members.map(m => ({ _id: m._id, fullName: m.fullName }))
      };

      return res.status(StatusCodes.OK).json(spotlightWithMembers);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/{id}:
   *   put:
   *     summary: Update a spotlight schedule
   *     tags: [Spotlight]
   */
  @Put("/:id")
  @UseBefore(canAccess("spotlight", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateSpotlightDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const spotlight = await this.spotlightRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!spotlight) throw new NotFoundError("Spotlight not found");

      if (data.members) spotlight.members = data.members.map(id => new ObjectId(id));
      if (data.scheduleDate) spotlight.scheduleDate = new Date(data.scheduleDate);
      if (data.status) spotlight.status = data.status;

      const saved = await this.spotlightRepo.save(spotlight);
      return res.status(StatusCodes.OK).json({
        message: "Spotlight updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/spotlights/{id}:
   *   delete:
   *     summary: Delete a spotlight schedule (Soft Delete)
   *     tags: [Spotlight]
   */
  @Delete("/:id")
  @UseBefore(canAccess("spotlight", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const spotlight = await this.spotlightRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!spotlight) throw new NotFoundError("Spotlight not found");

      spotlight.isDeleted = true;
      await this.spotlightRepo.save(spotlight);

      return res.status(StatusCodes.OK).json({ message: "Spotlight deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
