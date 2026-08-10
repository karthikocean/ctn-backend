import { JsonController, Get, Post, Param, QueryParam, Res, Req, UseBefore, NotFoundError, BadRequestError, Body } from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Training, TrainingStatus } from "../../entity/Training";
import { Member } from "../../entity/Member";
import { LessonProgress } from "../../entity/LessonProgress";
import { MemberTraining } from "../../entity/MemberTraining";
import { TrainingCategory } from "../../entity/TrainingCategory";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { validateModuleUsage } from "../../services/moduleUsage.service";
import { PointService } from "../../services/point.service";
import { SubscriptionService } from "../../services/subscription.service";

@JsonController("/trainings")
@UseBefore(MobileAuthMiddleware)
export class MobileTrainingController {
  private trainingRepo = AppDataSource.getMongoRepository(Training);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private progressRepo = AppDataSource.getMongoRepository(LessonProgress);
  private enrollmentRepo = AppDataSource.getMongoRepository(MemberTraining);
  private trainingCategoryRepo = AppDataSource.getMongoRepository(TrainingCategory);
  // private configRepo = AppDataSource.getMongoRepository(PointConfig);

  /**
   * @swagger
   * /mobile-api/trainings/active:
   *   get:
   *     summary: Get all active trainings
   *     tags: [Mobile Training]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Items per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search query for title and description
   *     responses:
   *       200:
   *         description: List of active trainings
   */
  @Get("/active")
  async getActive(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = new ObjectId(req.user.userId);

      // ✅ Fetch training discount from the member's active subscription plan
      let trainingDiscountPercentage = 0;
      let planTitle: string | null = null;
      try {
        const subscriptionService = new SubscriptionService();
        const plan = await subscriptionService.getMemberPlan(userId);
        trainingDiscountPercentage = plan.benefits?.trainingDiscountPercentage || 0;
        planTitle = plan.title || null;
      } catch {
        // No active plan — no discount
      }

      const whereClause: any = {
        status: TrainingStatus.ACTIVE,
        isDeleted: false
      };

      if (search && search.trim()) {
        whereClause.$or = [
          { title: { $regex: new RegExp(search.trim(), "i") } },
          { description: { $regex: new RegExp(search.trim(), "i") } }
        ];
      }

      const trainings = await this.trainingRepo.find({
        where: whereClause,
        order: { createdAt: "DESC" }
      });

      const memberOid = new ObjectId(userId);

      // Fetch enrollments for this user
      const enrollments = await this.enrollmentRepo.find({
        where: { memberId: memberOid }
      });

      // Fetch all progress for this user to calculate completion counts
      const allProgress = await this.progressRepo.find({
        where: { memberId: memberOid }
      });

      // Fetch categories for the trainings
      const categoryIds = [...new Set(trainings.map(t => t.categoryId).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.trainingCategoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];
      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

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

        const categoryName = t.categoryId ? categoryMap.get(t.categoryId.toString()) || null : null;

        // ✅ Compute discounted unlock cost based on plan
        const discountAmount = Math.floor(t.overallPoints * (trainingDiscountPercentage / 100));
        const discountedPoints = Math.max(0, t.overallPoints - discountAmount);

        return {
          ...t,
          categoryName,
          lessons: lessonsWithProgress,
          completedLessonsCount: completedCount,
          totalLessonsCount: totalLessons,
          totalDuration,
          isUnlocked: t.isFree || !!enrollment,
          lastWatchedLessonId,
          lastWatchedLessonProgress: lastWatchedProgress ? {
            position: lastWatchedProgress.lastWatchedPosition,
            isCompleted: lastWatchedProgress.isCompleted,
            updatedAt: lastWatchedProgress.updatedAt
          } : null,
          discountedPoints,
          discountAmount
        };
      });

      const groupsMap = new Map<string, { categoryId: string | null; categoryName: string; trainings: any[] }>();

      for (const t of data) {
        const catIdStr = t.categoryId ? t.categoryId.toString() : "uncategorized";
        const catName = t.categoryName || "General";

        if (!groupsMap.has(catIdStr)) {
          groupsMap.set(catIdStr, {
            categoryId: t.categoryId ? t.categoryId.toString() : null,
            categoryName: catName,
            trainings: []
          });
        }
        groupsMap.get(catIdStr)!.trainings.push(t);
      }

      const groupedData = Array.from(groupsMap.values());

      return res.status(StatusCodes.OK).json({
        success: true,
        planTitle,
        trainingDiscountPercentage,
        description: trainingDiscountPercentage > 0
          ? `Your ${planTitle} plan gives you a ${trainingDiscountPercentage}% discount on all training unlocks.`
          : "No training discount is available on your current plan.",
        data: groupedData
      });
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

      let categoryName = null;
      if (training.categoryId) {
        const cat = await this.trainingCategoryRepo.findOneBy({ _id: training.categoryId });
        categoryName = cat ? cat.name : null;
      }

      const memberOid = new ObjectId(userId);
      const member = await this.memberRepo.findOneBy({ _id: memberOid });
      if (!member) throw new NotFoundError("Member not found");

      // Check if already unlocked using the enrollment collection
      const isUnlocked = await this.enrollmentRepo.findOneBy({
        memberId: memberOid,
        trainingId: training._id
      });

      // Fetch progress for each lesson
      const progressList = await this.progressRepo.find({
        where: { memberId: memberOid, trainingId: training._id }
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
          categoryName,
          lessons: lessonsWithProgress,
          totalDuration: this.sumDurations(training.lessons?.map(l => l.duration) || [])
        },
        isUnlocked: training.isFree || !!isUnlocked,
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

      // Validate module usage limit before unlocking/enrolling
      await validateModuleUsage(userId, "Trainings");

      const training = await this.trainingRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });
      if (!training) throw new NotFoundError("Training not found");

      const memberOid = new ObjectId(userId);
      const member = await this.memberRepo.findOneBy({ _id: memberOid });
      if (!member) throw new NotFoundError("Member not found");

      const isUnlocked = await this.enrollmentRepo.findOneBy({
        memberId: memberOid,
        trainingId: training._id
      });
      if (isUnlocked || training.isFree) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: training.isFree ? "Free training course" : "Training already unlocked",
          isUnlocked: true
        });
      }

      // ✅ Apply trainingDiscountPercentage from subscription plan benefits
      let basePoints = inputPoints !== undefined ? inputPoints : training.overallPoints;
      let discountPercentage = 0;
      try {
        const subscriptionService = new SubscriptionService();
        const plan = await subscriptionService.getMemberPlan(memberOid);
        discountPercentage = plan.benefits?.trainingDiscountPercentage || 0;
      } catch {
        // No active plan or benefit — use full price
        discountPercentage = 0;
      }

      const discount = Math.floor(basePoints * (discountPercentage / 100));
      const pointsToDeduct = Math.max(0, basePoints - discount);

      if (member.points < pointsToDeduct) {
        throw new BadRequestError(`Insufficient points. You need ${pointsToDeduct} points.`);
      }

      // Deduct points using PointService to keep member_points and history in sync
      let remainingPoints = member.points;
      try {
        const pointService = new PointService();
        const deductResult = await pointService.deductPoints({
          memberId: memberOid,
          moduleName: "Trainings",
          points: pointsToDeduct,
          referenceId: training._id,
          actionType: "unlock"
        });
        remainingPoints = deductResult.balance;
      } catch (pointError) {
        console.error("Failed to record points deduction in history:", pointError);
        // Fallback to manual deduction if PointService fails
        member.points = Math.max(0, member.points - pointsToDeduct);
        await this.memberRepo.save(member);
        remainingPoints = member.points;
      }

      // Create new enrollment record
      const enrollment = new MemberTraining();
      enrollment.memberId = memberOid;
      enrollment.trainingId = training._id;
      await this.enrollmentRepo.save(enrollment);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Training unlocked successfully",
        remainingPoints: remainingPoints,
        isUnlocked: true,
        originalPoints: basePoints,
        discountApplied: discount,
        pointsSpent: pointsToDeduct
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

        // Validate module usage limit before auto-enrolling
        await validateModuleUsage(userId, "Trainings");

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

  /**
   * @swagger
   * /mobile-api/trainings/point-config:
   *   get:
   *     summary: Get point configurations for Trainings module (Mobile)
   *     tags: [Mobile Training]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Point configuration details for Trainings
   */
  @Get("/point/config")
  async getPointConfig(@Req() req: any, @Res() res: any) {
    try {
      const userId = new ObjectId(req.user.userId);

      // ✅ Fetch training discount percentage from the member's active subscription plan
      let trainingDiscountPercentage = 0;
      let planTitle: string | null = null;
      try {
        const subscriptionService = new SubscriptionService();
        const plan = await subscriptionService.getMemberPlan(userId);
        trainingDiscountPercentage = plan.benefits?.trainingDiscountPercentage || 0;
        planTitle = plan.title || null;
      } catch {
        // No active plan — no discount
        trainingDiscountPercentage = 0;
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          planTitle,
          trainingDiscountPercentage,
          description: trainingDiscountPercentage > 0
            ? `Your ${planTitle} plan gives you a ${trainingDiscountPercentage}% discount on all training unlocks.`
            : "No training discount is available on your current plan."
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
