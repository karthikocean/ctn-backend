import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("point_history")
@Index(["memberId"])
@Index(["memberId", "moduleName", "actionType", "referenceId"], { unique: true })
export class PointHistory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    moduleName!: string;

  @Column()
    referenceId!: ObjectId;

  @Column()
    actionType!: string;

  @Column({ default: "earned" })
    type!: string; // earned | spent

  @Column({ type: "number" })
    points!: number;

  @Column({ type: "number" })
    balanceAfter!: number;

  @CreateDateColumn()
    createdAt!: Date;
}
