import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("daily_score_histories")
@Index(["memberId"])
@Index(["memberId", "moduleName", "date"], { unique: true })
export class DailyScoreHistory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    moduleName!: string; // Post | Ask | Give | Requirement | Milestone

  @Column({ type: "number" })
    score!: number;

  @Column()
    date!: string; // YYYY-MM-DD

  @Column()
    referenceId!: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;
}
