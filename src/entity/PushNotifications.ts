import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum NotificationModule {
  GENERAL = "GENERAL",
  CONNECTION = "CONNECTION", // Mapped to Follow Requests
  // CHAT = "CHAT", // Mapped to Messages
  PROMOTION = "PROMOTION",
  ASK = "ASK",
  GIVE = "GIVE",
  REQUIREMENT = "REQUIREMENT",
  WORKORDER = "WORKORDER",
  OTHER = "OTHER",
  REMINDER = "REMINDER",
  BIRTHDAY = "BIRTHDAY",
  TRIAL = "TRIAL",

  // New modules requested by user
  ONE_TO_ONE = "ONE_TO_ONE",
  THANK_YOU_SLIP = "THANK_YOU_SLIP",
  FOLLOW_REQUEST = "FOLLOW_REQUEST",
  REFERRAL = "REFERRAL",
  SPOTLIGHT = "SPOTLIGHT",
  MESSAGE = "MESSAGE",
  MESSAGE_REQUEST = "MESSAGE_REQUEST",
  EVENT = "EVENT",
  TRAINING = "TRAINING",
  PLAN_EXPIRY = "PLAN_EXPIRY",
  UPGRADE = "UPGRADE",
  DOWNGRADE = "DOWNGRADE",
  DAILY_TASK = "DAILY_TASK",
  ANNOUNCEMENT = "ANNOUNCEMENT",
  SUGGESTION = "SUGGESTION"
}

@Entity("push_notifications")
@Index(["receiverId", "createdAt"])
export class PushNotification {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    sub!: string;

  @Column()
    msg!: string;

  @Column({
    type: "enum",
    enum: NotificationModule,
    default: NotificationModule.GENERAL,
  })
    moduleName!: NotificationModule;

  @Column({ nullable: true })
    moduleId?: ObjectId;

  @Column({ nullable: true })
    senderId?: ObjectId;

  @Column()
    receiverId!: ObjectId;

  @Column({ default: false })
    isRead!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
