import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("milestones")
@Index(["memberId"])
@Index(["isDeleted"])
@Index(["createdAt"])
export class Milestone {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({ nullable: true })
    mediaUrl?: string;

  @Column({ nullable: true })
    caption?: string;

  @Column({ default: 0 })
    viewCount!: number;

  @Column({ default: 0 })
    clapsCount!: number;

  @Column({ default: false })
    isDeleted!: boolean;
  @Column()
    expiresAt!: Date;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
