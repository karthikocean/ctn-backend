import { JsonController, Get, Post, Param, Res, Req, UseBefore, NotFoundError, BadRequestError, Body } from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Training, TrainingStatus } from "../../entity/Training";
import { Member } from "../../entity/Member";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/trainings")
@UseBefore(MobileAuthMiddleware)
export class MobileTrainingController {
  private trainingRepo = AppDataSource.getMongoRepository(Training);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /mobile-api/trainings/active:
   *   get:
   *     summary: Get all active trainings
   *     tags: [Mobile Training]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of active trainings
   */
  @Get("/active")
  async getActive(@Res() res: any) {
    try {
      const trainings = await this.trainingRepo.find({
        where: {
          status: TrainingStatus.ACTIVE,
          isDeleted: false
        },
        order: { createdAt: "DESC" }
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: trainings
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/trainings/{id}:
   *   get:
   *     summary: View a training and deduct points if not already unlocked
   *     tags: [Mobile Training]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Req() req: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);

      const training = await this.trainingRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });
      if (!training) throw new NotFoundError("Training not found");

      const member = await this.memberRepo.findOneBy({ _id: userId });
      if (!member) throw new NotFoundError("Member not found");

      // Check if already unlocked
      const isUnlocked = member.unlockedTrainings?.some(tid => tid.toString() === training._id.toString());

      return res.status(StatusCodes.OK).json({
        success: true,
        data: training,
        isUnlocked: !!isUnlocked,
        remainingPoints: member.points
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/trainings/{id}/unlock:
   *   post:
   *     summary: Explicitly unlock a training using points
   *     tags: [Mobile Training]
   */
  @Post("/:id/unlock")
  async unlock(@Param("id") id: string, @Body() body: { points?: number }, @Req() req: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const { points: inputPoints } = body;

      const training = await this.trainingRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });
      if (!training) throw new NotFoundError("Training not found");

      const member = await this.memberRepo.findOneBy({ _id: userId });
      if (!member) throw new NotFoundError("Member not found");

      const isUnlocked = member.unlockedTrainings?.some(tid => tid.toString() === training._id.toString());
      if (isUnlocked) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Training already unlocked",
          isUnlocked: true
        });
      }

      const pointsToDeduct = inputPoints !== undefined ? inputPoints : training.overallPoints;

      if (member.points < pointsToDeduct) {
        throw new BadRequestError(`Insufficient points. You need ${pointsToDeduct} points.`);
      }

      member.points -= pointsToDeduct;
      if (!member.unlockedTrainings) member.unlockedTrainings = [];
      member.unlockedTrainings.push(training._id);
      await this.memberRepo.save(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Training unlocked successfully",
        remainingPoints: member.points,
        isUnlocked: true
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
