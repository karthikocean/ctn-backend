import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

export enum NotificationModule {
  GENERAL = "GENERAL",
  CONNECTION = "CONNECTION",
  CHAT = "CHAT",
  POST = "POST",
  ASK = "ASK",
  GIVE = "GIVE",
  REQUIREMENT = "REQUIREMENT",
  WORKORDER = "WORKORDER",
  OTHER = "OTHER",
  REMINDER = "REMINDER"
}

@Entity("push_notifications")
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
