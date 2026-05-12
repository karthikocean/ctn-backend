import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("milestone_views")
@Index(["milestoneId", "viewerId"], { unique: true })
@Index(["milestoneId"])
export class MilestoneView {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    milestoneId!: ObjectId;

  @Column()
    viewerId!: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;
}
