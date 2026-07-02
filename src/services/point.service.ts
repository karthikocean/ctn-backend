import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { PointConfig, PointConfigType } from "../entity/PointConfig";
import { PointHistory } from "../entity/PointHistory";
import { MemberPoints } from "../entity/MemberPoints";
import { SubscriptionService } from "./subscription.service";

export class PointService {
  private configRepo = AppDataSource.getMongoRepository(PointConfig);
  private historyRepo = AppDataSource.getMongoRepository(PointHistory);
  private memberPointsRepo = AppDataSource.getMongoRepository(MemberPoints);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private subscriptionService = new SubscriptionService();

  /**
   * Helper to retrieve point config for a module and type.
   */
  async getPointConfig(moduleName: string, type: PointConfigType): Promise<PointConfig | null> {
    return this.configRepo.findOne({
      where: {
        moduleName: { $regex: new RegExp(`^${moduleName}$`, "i") },
        type,
        isDeleted: false
      } as any
    });
  }

  /**
   * Helper to fetch current member points balance.
   */
  async getMemberBalance(memberId: ObjectId): Promise<number> {
    const record = await this.memberPointsRepo.findOneBy({ memberId });
    return record ? record.totalPoints : 0;
  }

  /**
   * Helper to save point history records.
   */
  async createHistory(
    memberId: ObjectId,
    moduleName: string,
    referenceId: ObjectId,
    actionType: string,
    points: number,
    balanceAfter: number
  ): Promise<PointHistory> {
    const history = new PointHistory();
    history.memberId = memberId;
    history.moduleName = moduleName;
    history.referenceId = referenceId;
    history.actionType = actionType;
    history.points = points;
    history.balanceAfter = balanceAfter;
    return this.historyRepo.save(history);
  }

  /**
   * Core function to dynamically award points for creation/response actions,
   * factoring in subscription plan multipliers.
   */
  async awardPoints(params: {
    memberId: string | ObjectId;
    moduleName: string;
    type: PointConfigType;
    referenceId: string | ObjectId;
  }): Promise<{ awarded: number; balance: number }> {
    const memberOid = new ObjectId(params.memberId);
    const referenceOid = new ObjectId(params.referenceId);
    const { moduleName, type } = params;

    // 1. Fetch Config
    const config = await this.getPointConfig(moduleName, type);
    if (!config || config.points <= 0) {
      const balance = await this.getMemberBalance(memberOid);
      return { awarded: 0, balance };
    }

    // 2. Check for duplicate history entry
    const existing = await this.historyRepo.findOne({
      where: {
        memberId: memberOid,
        moduleName: { $regex: new RegExp(`^${moduleName}$`, "i") },
        actionType: type,
        referenceId: referenceOid
      } as any
    });

    if (existing) {
      const balance = await this.getMemberBalance(memberOid);
      return { awarded: 0, balance };
    }

    // 3. Apply subscription points multiplier
    let multiplier = 1;
    try {
      const plan = await this.subscriptionService.getMemberPlan(memberOid);
      multiplier = plan.benefits?.pointMultiplier || 1;
    } catch {
      // Gracefully fall back to 1x multiplier if member has no active subscription/trial
      multiplier = 1;
    }

    const calculatedPoints = Math.round(config.points * multiplier);

    // 4. Attempt dynamic transaction if MongoDB Replica Set/Session is supported
    const mongoClient = (AppDataSource.mongoManager.queryRunner?.connection?.driver as any)?.mongoClient;
    if (mongoClient && typeof mongoClient.startSession === "function") {
      const session = mongoClient.startSession();
      try {
        let result: any = null;
        await session.withTransaction(async () => {
          // Double check duplicate history within transaction context
          const existingTx = await this.historyRepo.findOne({
            where: {
              memberId: memberOid,
              moduleName: { $regex: new RegExp(`^${moduleName}$`, "i") },
              actionType: type,
              referenceId: referenceOid
            } as any
          });
          if (existingTx) {
            const balanceTx = await this.getMemberBalance(memberOid);
            result = { awarded: 0, balance: balanceTx };
            return;
          }

          // Update or Create MemberPoints record
          let memberPoints = await this.memberPointsRepo.findOneBy({ memberId: memberOid });
          if (!memberPoints) {
            memberPoints = new MemberPoints();
            memberPoints.memberId = memberOid;
            memberPoints.totalPoints = 0;
          }
          memberPoints.totalPoints += calculatedPoints;
          await this.memberPointsRepo.save(memberPoints);

          // Update Member model points
          const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
          if (member) {
            member.points = (member.points || 0) + calculatedPoints;
            await this.memberRepo.save(member);
          }

          // Create PointHistory entry
          const history = new PointHistory();
          history.memberId = memberOid;
          history.moduleName = moduleName;
          history.referenceId = referenceOid;
          history.actionType = type;
          history.type = "earned";
          history.points = calculatedPoints;
          history.balanceAfter = memberPoints.totalPoints;
          await this.historyRepo.save(history);

          result = { awarded: calculatedPoints, balance: memberPoints.totalPoints };
        });

        if (result) return result;
      } catch (transactionError: any) {
        if (
          transactionError.message?.includes("Transaction") ||
          transactionError.message?.includes("session") ||
          transactionError.codeName === "IllegalOperation"
        ) {
          // Fall through to non-transactional logic
        } else if (transactionError.code === 11000) {
          // Duplicate key collision gracefully handled
          const balance = await this.getMemberBalance(memberOid);
          return { awarded: 0, balance };
        } else {
          throw transactionError;
        }
      } finally {
        await session.endSession();
      }
    }

    // 5. Non-transactional execution fallback with manual rollback on collision
    try {
      let memberPoints = await this.memberPointsRepo.findOneBy({ memberId: memberOid });
      if (!memberPoints) {
        memberPoints = new MemberPoints();
        memberPoints.memberId = memberOid;
        memberPoints.totalPoints = 0;
      }
      memberPoints.totalPoints += calculatedPoints;
      await this.memberPointsRepo.save(memberPoints);

      const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
      if (member) {
        member.points = (member.points || 0) + calculatedPoints;
        await this.memberRepo.save(member);
      }

      const history = new PointHistory();
      history.memberId = memberOid;
      history.moduleName = moduleName;
      history.referenceId = referenceOid;
      history.actionType = type;
      history.type = "earned";
      history.points = calculatedPoints;
      history.balanceAfter = memberPoints.totalPoints;
      await this.historyRepo.save(history);

      return { awarded: calculatedPoints, balance: memberPoints.totalPoints };
    } catch (err: any) {
      if (err.code === 11000) {
        // Duplicate index collision: rollback the added points
        let memberPoints = await this.memberPointsRepo.findOneBy({ memberId: memberOid });
        if (memberPoints) {
          memberPoints.totalPoints = Math.max(0, memberPoints.totalPoints - calculatedPoints);
          await this.memberPointsRepo.save(memberPoints);
        }
        const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
        if (member) {
          member.points = Math.max(0, (member.points || 0) - calculatedPoints);
          await this.memberRepo.save(member);
        }
        const balance = await this.getMemberBalance(memberOid);
        return { awarded: 0, balance };
      }
      throw err;
    }
  }

  /**
   * Helper to deduct points for unlocking training or other actions.
   */
  async deductPoints(params: {
    memberId: string | ObjectId;
    moduleName: string;
    points: number;
    referenceId: string | ObjectId;
    actionType?: string;
  }): Promise<{ balance: number }> {
    const memberOid = new ObjectId(params.memberId);
    const referenceOid = new ObjectId(params.referenceId);
    const { moduleName, points, actionType = "spent" } = params;

    if (points <= 0) {
      const balance = await this.getMemberBalance(memberOid);
      return { balance };
    }

    let memberPoints = await this.memberPointsRepo.findOneBy({ memberId: memberOid });
    if (!memberPoints) {
      memberPoints = new MemberPoints();
      memberPoints.memberId = memberOid;
      memberPoints.totalPoints = 0;
    }
    memberPoints.totalPoints = Math.max(0, memberPoints.totalPoints - points);
    await this.memberPointsRepo.save(memberPoints);

    const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
    if (member) {
      member.points = Math.max(0, (member.points || 0) - points);
      await this.memberRepo.save(member);
    }

    const history = new PointHistory();
    history.memberId = memberOid;
    history.moduleName = moduleName;
    history.referenceId = referenceOid;
    history.actionType = actionType;
    history.type = "spent";
    history.points = -points;
    history.balanceAfter = memberPoints.totalPoints;
    await this.historyRepo.save(history);

    return { balance: memberPoints.totalPoints };
  }
}
