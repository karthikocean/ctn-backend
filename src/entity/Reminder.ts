import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum ReminderStatus {
  PENDING = "Pending",
  COMPLETED = "Completed",
  CANCELLED = "Cancelled"
}

export enum RepeatType {
  ONCE = "Once",
  DAILY = "Daily",
  WEEKLY = "Weekly",
  MONTHLY = "Monthly",
  YEARLY = "Yearly"
}

export enum NotifyBy {
  APP = "APP",
  EMAIL = "EMAIL",
  SMS = "SMS",
  WHATSAPP = "WHATSAPP",
  PUSH = "PUSH"
}

@Entity("reminders")
@Index(["status", "isDeleted", "nextReminderDate"])
export class Reminder {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    title!: string;

  @Column({ nullable: true })
    description?: string;

  // @Column()
  //   module!: string; // e.g. EVENT, WORKORDER, TASK, PPM, AMC, CUSTOM

  // @Column({ nullable: true })
  //   moduleId?: ObjectId;

  @Column()
    reminderDate!: Date;

  @Column()
    reminderTime!: string;

  @Column({
    type: "enum",
    enum: RepeatType,
    default: RepeatType.ONCE
  })
    repeatType!: RepeatType;

  @Column({ default: 1 })
    repeatInterval!: number;

  @Column({ nullable: true })
    recipients!: ObjectId[];

  @Column({
    type: "enum",
    enum: NotifyBy,
    array: true
  })
    notifyBy!: NotifyBy[];

  @Column({
    type: "enum",
    enum: ReminderStatus,
    default: ReminderStatus.PENDING
  })
    status!: ReminderStatus;

  @Column({ nullable: true })
    lastTriggeredAt?: Date;

  @Column()
    nextReminderDate!: Date;

  @Column({ default: true })
    isActive!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column()
    createdBy!: ObjectId;

  @Column()
    updatedBy!: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
