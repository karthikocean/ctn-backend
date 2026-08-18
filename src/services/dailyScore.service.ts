import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
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
   * for the first time today. Idempotent — safe to call multiple times.
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

    // Idempotency pre-check: avoid unnecessary DB exception for already-awarded modules
    const existing = await this.dailyScoreHistoryRepo.findOne({
      where: {
        memberId,
        moduleName: normalizedModule,
        date: dateStr
      } as any
    });
    if (existing) {
      console.log(`[DailyScore] Already awarded today for module ${normalizedModule} to member ${memberId}`);
      return 0;
    }

    try {
      // Write score history entry (unique index on memberId + moduleName + date enforces idempotency)
      const history = new DailyScoreHistory();
      history.memberId = memberId;
      history.moduleName = normalizedModule;
      history.score = score;
      history.date = dateStr;
      history.referenceId = referenceId;
      await this.dailyScoreHistoryRepo.save(history);

      // Increment member's dailyScore counter
      await this.memberRepo.updateOne(
        { _id: memberId, isDeleted: false },
        { $inc: { dailyScore: score } }
      );

      console.log(`[DailyScore] Awarded ${score} daily score to member ${memberId} for module ${normalizedModule} on ${dateStr}`);
      return score;
    } catch (err: any) {
      if (err.code === 11000) {
        // Unique index collision: race condition — already awarded concurrently
        console.log(`[DailyScore] Duplicate index — daily score already awarded for module ${normalizedModule} to member ${memberId}`);
        return 0;
      }
      throw err;
    }
  }
}
