import { JsonController, Get, Post, Param, QueryParam, Res, Req, UseBefore, NotFoundError, BadRequestError, Body } from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Training, TrainingStatus } from "../../entity/Training";
import { Member } from "../../entity/Member";
import { LessonProgress } from "../../entity/LessonProgress";
import { MemberTraining } from "../../entity/MemberTraining";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import pagination from "../../utils/pagination";

@JsonController("/trainings")
@UseBefore(MobileAuthMiddleware)
export class MobileTrainingController {
  private trainingRepo = AppDataSource.getMongoRepository(Training);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private progressRepo = AppDataSource.getMongoRepository(LessonProgress);
  private enrollmentRepo = AppDataSource.getMongoRepository(MemberTraining);

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
  async getActive(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = new ObjectId(req.user.userId);
      const [trainings, total] = await this.trainingRepo.findAndCount({
        where: {
          status: TrainingStatus.ACTIVE,
          isDeleted: false
        },
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Fetch enrollments for this user
      const enrollments = await this.enrollmentRepo.find({
        where: { memberId: userId }
      });

      // Fetch all progress for this user to calculate completion counts
      const allProgress = await this.progressRepo.find({
        where: { memberId: userId }
      });

      const data = trainings.map(t => {
        const trainingProgress = allProgress.filter(p => p.trainingId.toString() === t._id.toString());
        const completedCount = trainingProgress.filter(p => p.isCompleted).length;
        const totalLessons = t.lessons?.length || 0;

        // Find enrollment to get the last watched lesson
        const enrollment = enrollments.find(e => e.trainingId.toString() === t._id.toString());
        const lastWatchedLessonId = enrollment?.lessonId?.toString() || null;

        // Map lessons with their individual progress
        const lessonsWithProgress = t.lessons?.map(lesson => {
          const lp = trainingProgress.find(p => p.lessonId.toString() === lesson._id?.toString());
          const durationSec = this.durationToSeconds(lesson.duration);
          const lastPos = lp?.lastWatchedPosition || 0;

          // Calculate if completed based on position or existing flag
          const isCompleted = lp?.isCompleted || (durationSec > 0 && lastPos >= durationSec);

          return {
            ...lesson,
            progress: {
              position: lastPos,
              isCompleted: isCompleted,
              updatedAt: lp?.updatedAt
            }
          };
        });

        // Find detailed progress for the last watched lesson (summary at top level)
        const lastWatchedProgress = lastWatchedLessonId
          ? trainingProgress.find(p => p.lessonId.toString() === lastWatchedLessonId.toString())
          : null;

        // Calculate total duration
        const totalDuration = this.sumDurations(t.lessons?.map(l => l.duration) || []);

        return {
          ...t,
          lessons: lessonsWithProgress,
          completedLessonsCount: completedCount,
          totalLessonsCount: totalLessons,
          totalDuration,
          isUnlocked: !!enrollment,
          lastWatchedLessonId,
          lastWatchedLessonProgress: lastWatchedProgress ? {
            position: lastWatchedProgress.lastWatchedPosition,
            isCompleted: lastWatchedProgress.isCompleted,
            updatedAt: lastWatchedProgress.updatedAt
          } : null
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private sumDurations(durations: (string | undefined)[]): string {
    let totalSeconds = 0;
    durations.forEach(d => {
      if (!d) return;
      const parts = d.split(":").map(Number);
      if (parts.length === 3) {
        totalSeconds += (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
      } else if (parts.length === 2) {
        totalSeconds += (parts[0] || 0) * 60 + (parts[1] || 0);
      } else if (parts.length === 1) {
        totalSeconds += (parts[0] || 0);
      }
    });

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    const parts = [];
    if (h > 0) parts.push(h.toString().padStart(2, "0"));
    parts.push(m.toString().padStart(2, "0"));
    parts.push(s.toString().padStart(2, "0"));

    return parts.join(":");
  }

  private durationToSeconds(duration: string | undefined): number {
    if (!duration) return 0;
    const parts = duration.split(":").map(Number);
    if (parts.length === 3) {
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    } else if (parts.length === 2) {
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    } else if (parts.length === 1) {
      return (parts[0] || 0);
    }
    return 0;
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

      // Check if already unlocked using the enrollment collection
      const isUnlocked = await this.enrollmentRepo.findOneBy({
        memberId: userId,
        trainingId: training._id
      });

      // Fetch progress for each lesson
      const progressList = await this.progressRepo.find({
        where: { memberId: userId, trainingId: training._id }
      });

      const progressMap = new Map<string, any>(progressList.map(p => [p.lessonId.toString(), p]));

      const lessonsWithProgress = training.lessons?.map(lesson => {
        const lp = progressMap.get(lesson._id?.toString() || "");
        const durationSec = this.durationToSeconds(lesson.duration);
        const lastPos = lp?.lastWatchedPosition || 0;

        // Calculate if completed based on position or existing flag
        const isCompleted = lp?.isCompleted || (durationSec > 0 && lastPos >= durationSec);

        return {
          ...lesson,
          progress: {
            lastWatchedPosition: lastPos,
            isCompleted: isCompleted
          }
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...training,
          lessons: lessonsWithProgress,
          totalDuration: this.sumDurations(training.lessons?.map(l => l.duration) || [])
        },
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

      const isUnlocked = await this.enrollmentRepo.findOneBy({
        memberId: userId,
        trainingId: training._id
      });
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
      await this.memberRepo.save(member);

      // Create new enrollment record
      const enrollment = new MemberTraining();
      enrollment.memberId = userId;
      enrollment.trainingId = training._id;
      await this.enrollmentRepo.save(enrollment);

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

  /**
   * @swagger
   * /mobile-api/trainings/lesson-progress:
   *   post:
   *     summary: Update video watch progress for a lesson
   *     tags: [Mobile Training]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               trainingId:
   *                 type: string
   *               lessonId:
   *                 type: string
   *               position:
   *                 type: number
   *               isCompleted:
   *                 type: boolean
   */
  @Post("/lesson-progress")
  async updateProgress(@Req() req: any, @Body() data: { trainingId: string, lessonId: string, position: number, isCompleted?: boolean }, @Res() res: any) {
    try {
      const userId = new ObjectId(req.user.userId);
      const { trainingId, lessonId, position, isCompleted = false } = data;

      if (!ObjectId.isValid(trainingId)) throw new BadRequestError("Invalid Training ID");

      // 1. Check if user is enrolled in this training
      const trainingOid = new ObjectId(trainingId);
      let enrollment = await this.enrollmentRepo.findOneBy({
        memberId: userId,
        trainingId: trainingOid
      });

      if (!enrollment) {
        // If not enrolled, check if the training is FREE
        const training = await this.trainingRepo.findOneBy({ _id: trainingOid });
        if (!training) throw new NotFoundError("Training not found");

        // Auto-enroll for free trainings
        enrollment = new MemberTraining();
        enrollment.memberId = userId;
        enrollment.trainingId = trainingOid;
        await this.enrollmentRepo.save(enrollment);
      } else {
        // Update the last watched lesson and timestamp on the enrollment
        enrollment.lessonId = new ObjectId(lessonId);
        await this.enrollmentRepo.save(enrollment);
      }

      // 2. Update or Create progress record
      let progress = await this.progressRepo.findOneBy({
        memberId: userId,
        trainingId: trainingOid,
        lessonId: new ObjectId(lessonId)
      });

      if (!progress) {
        progress = new LessonProgress();
        progress.memberId = userId;
        progress.trainingId = trainingOid;
        progress.lessonId = new ObjectId(lessonId);
      }

      progress.lastWatchedPosition = position;
      progress.isCompleted = isCompleted || progress.isCompleted;

      await this.progressRepo.save(progress);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: progress
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
