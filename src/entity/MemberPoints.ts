import {
  Entity,
  ObjectIdColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("member_points")
@Index(["memberId"], { unique: true })
export class MemberPoints {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({ type: "number", default: 0 })
    totalPoints!: number;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
