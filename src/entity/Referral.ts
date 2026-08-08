import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum ReferralStatus {
  PENDING = "PENDING",
  CONVERTED = "CONVERTED",
  CLOSED = "CLOSED",
  NOT_CONTACTED = "NOT_CONTACTED",
  CONTACTED = "CONTACTED",
  REPORTED = "REPORTED",

}

@Entity("referrals")
@Index(["senderId"])
@Index(["receiverId"])
@Index(["status"])
export class Referral {
  @ObjectIdColumn()
  _id!: ObjectId;

  @Column()
  senderId!: ObjectId; // Person who gave the referral

  @Column()
  receiverId!: ObjectId; // Person who received the referral

  @Column()
  referralName!: string;

  @Column({ nullable: true })
  referralMobile?: string;

  @Column({ nullable: true })
  referralEmail?: string;

  @Column({ nullable: true })
  location?: string;

  @Column({ nullable: true })
  comments?: string;

  @Column({
    type: "enum",
    enum: ReferralStatus,
    default: ReferralStatus.PENDING
  })
  status!: ReferralStatus;

  @Column({ nullable: true })
  reason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
