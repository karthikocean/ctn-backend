import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum UserReferralStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED"
}

@Entity("user_referrals")
@Index(["referrerId"])
@Index(["referredUserId"], { unique: true })
@Index(["status"])
@Index(["createdAt"])
export class UserReferral {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    referrerId!: ObjectId; // Member who shared the referral code

  @Column()
    referredUserId!: ObjectId; // Member who registered using the code

  @Column()
    referralCode!: string; // Referral code used

  @Column({ type: "number", default: 0 })
    referrerReward!: number; // Reward amount credited to referrer

  @Column({ type: "number", default: 0 })
    referredUserReward!: number; // Reward amount credited to referred user

  @Column({
    type: "enum",
    enum: UserReferralStatus,
    default: UserReferralStatus.COMPLETED
  })
    status!: UserReferralStatus;

  @Column({ nullable: true })
    rewardedAt?: Date;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
