import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("member_subscriptions")
@Index(["memberId", "status"])
@Index(["memberId"])
@Index(["status"])
@Index(["isDeleted"])
export class MemberSubscription {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    planId!: ObjectId;

  @Column()
    type!: string; // "FREE" | "TRIAL" | "PREMIUM" | "BUSINESS"

  @Column()
    status!: string; // "ACTIVE" | "EXPIRED" | "CANCELLED"

  @Column()
    startDate!: Date;

  @Column()
    endDate!: Date;

  @Column({ default: false })
    isTrial!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
