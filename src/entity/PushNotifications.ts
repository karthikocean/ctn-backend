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
  DIRECT_MEET = "DIRECT_MEET",
  BUSINESS_DONE = "BUSINESS_DONE",
  FOLLOW_REQUEST = "FOLLOW_REQUEST",
  RECOMMENDATIONS = "RECOMMENDATIONS",
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
  SUGGESTION = "SUGGESTION",
  ANNIVERSARY = "ANNIVERSARY",
  ENQUIRY = "ENQUIRY",
  SUPPORT = "SUPPORT",
  FRANCHISE_APPLICATION = "FRANCHISE_APPLICATION"
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

  @Column({ nullable: true })
    receiverId?: ObjectId;

  @Column({ nullable: true })
    name?: string;

  @Column({ nullable: true })
    phone?: string;

  @Column({ nullable: true })
    email?: string;

  @Column({ default: false })
    isRead!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
