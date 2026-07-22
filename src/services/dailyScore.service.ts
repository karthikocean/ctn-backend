import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { MemberPoints } from "../entity/MemberPoints";
import { PointHistory } from "../entity/PointHistory";
import { DailyScoreHistory } from "../entity/DailyScoreHistory";

const MODULE_SCORE_MAP: Record<string, number> = {
  Post: 20,
  Ask: 10,
  Give: 20,
  Requirement: 30,
  Milestone: 20
};

export class DailyScoreService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private memberPointsRepo = AppDataSource.getMongoRepository(MemberPoints);
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);
  private dailyScoreHistoryRepo = AppDataSource.getMongoRepository(DailyScoreHistory);

  private normalizeModuleName(moduleName: string): string {
    const normalized = moduleName.toLowerCase().trim();
    if (normalized === "post" || normalized === "promotion") return "Post";
    if (normalized === "ask") return "Ask";
    if (normalized === "give") return "Give";
    if (normalized === "requirement" || normalized === "requirements") return "Requirement";
    if (normalized === "milestone" || normalized === "milestones" || normalized === "mile stone") return "Milestone";
    return moduleName;
  }

  private getLocalDateString(): string {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const now = new Date(new Date().getTime() + IST_OFFSET);
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Award daily score points to a member if they have created a specific module post
   * for the first time today.
   */
  async awardDailyScore(
    memberId: ObjectId,
    moduleName: string,
    referenceId: ObjectId
  ): Promise<number> {
    const normalizedModule = this.normalizeModuleName(moduleName);
    const score = MODULE_SCORE_MAP[normalizedModule];
    if (!score) {
      console.log(`[DailyScore] No daily score configured for module: ${moduleName}`);
      return 0;
    }

    const dateStr = this.getLocalDateString();

    // Check if daily score history entry already exists to avoid unnecessary DB operations/exceptions
    const existing = await this.dailyScoreHistoryRepo.findOne({
      where: {
        memberId,
        moduleName: normalizedModule,
        date: dateStr
      } as any
    });
    if (existing) {
      return 0;
    }

    try {
      // Create score history entry
      const history = new DailyScoreHistory();
      history.memberId = memberId;
      history.moduleName = normalizedModule;
      history.score = score;
      history.date = dateStr;
      history.referenceId = referenceId;
      await this.dailyScoreHistoryRepo.save(history);

      // Increment Member's dailyScore
      const member = await this.memberRepo.findOneBy({ _id: memberId, isDeleted: false });
      if (member) {
        member.dailyScore = (member.dailyScore || 0) + score;
        await this.memberRepo.save(member);
        console.log(`[DailyScore] Awarded ${score} daily score points to member ${memberId} for module ${normalizedModule}. New daily score: ${member.dailyScore}`);
        return score;
      }
    } catch (err: any) {
      if (err.code === 11000) {
        // Unique index collision: daily score already awarded for this module today
        console.log(`[DailyScore] Daily score already awarded today for module ${normalizedModule} to member ${memberId} (Duplicate index check)`);
        return 0;
      }
      throw err;
    }
    return 0;
  }

  /**
   * Scan for all active members with a daily score of 80 or higher
   * and reward them with 10 total points.
   */
  async runDailyScoreRewardCron(): Promise<void> {
    console.log("[DailyScore] Running daily score reward cron...");
    const members = await this.memberRepo.find({
      where: {
        dailyScore: { $gte: 80 },
        isDeleted: false
      } as any
    });

    console.log(`[DailyScore] Found ${members.length} members with daily score >= 80.`);

    for (const member of members) {
      try {
        console.log(`[DailyScore] Rewarding member ${member._id} (score: ${member.dailyScore}) with 10 total points...`);

        // Award 10 points to memberPoints
        let memberPoints = await this.memberPointsRepo.findOneBy({ memberId: member._id });
        if (!memberPoints) {
          memberPoints = new MemberPoints();
          memberPoints.memberId = member._id;
          memberPoints.totalPoints = 0;
        }
        memberPoints.totalPoints += 10;
        await this.memberPointsRepo.save(memberPoints);

        // Update Member points field
        member.points = (member.points || 0) + 10;
        await this.memberRepo.save(member);

        // Create PointHistory entry
        const history = new PointHistory();
        history.memberId = member._id;
        history.moduleName = "DailyScoreReward";
        history.referenceId = new ObjectId();
        history.actionType = "reward";
        history.type = "earned";
        history.points = 10;
        history.balanceAfter = memberPoints.totalPoints;
        await this.historyRepo.save(history);

        console.log(`[DailyScore] Awarded 10 points to member ${member._id}. New balance: ${memberPoints.totalPoints}`);
      } catch (error: any) {
        console.error(`[DailyScore] Failed to reward member ${member._id}:`, error.message);
      }
    }
  }

  /**
   * Reset daily scores back to 0 for all members.
   */
  async resetDailyScores(): Promise<void> {
    console.log("[DailyScore] Resetting daily scores for all members to 0...");
    const result = await this.memberRepo.updateMany(
      { isDeleted: false },
      { $set: { dailyScore: 0 } }
    );
    console.log(`[DailyScore] Reset completed. Modified count: ${result.modifiedCount}`);
  }
}
