import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("post_reports")
@Index(["reporterId"])
@Index(["postId"])
@Index(["reporterId", "postId"], { unique: true })
export class PostReport {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    reporterId!: ObjectId;

  @Column()
    postId!: ObjectId;

  @Column()
    reason!: string;

  @Column({ nullable: true })
    comments?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
