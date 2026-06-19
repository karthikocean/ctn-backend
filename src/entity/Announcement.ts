import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ObjectId } from "mongodb";

export enum AnnouncementStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  SCHEDULED = "scheduled"
}

export enum AnnouncementType {
  EVENT = "Event",
  ONLINE_STALL = "Online Stall"
}

export class StallItem {
  _id!: ObjectId;
  name!: string;
  size!: string;
  points!: number;
}

export class StallConfig {
  totalStallCount!: number;
  stalls!: StallItem[];
}

@Entity("announcements")
export class Announcement {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    title!: string;

  @Column()
    content!: string;

  @Column()
    image!: string; // URL from media upload

  @Column({ nullable: true })
    video?: string; // URL from media upload

  @Column({
    type: "enum",
    enum: AnnouncementStatus,
    default: AnnouncementStatus.DRAFT
  })
    status!: AnnouncementStatus;

  @Column({
    type: "enum",
    enum: AnnouncementType,
    default: AnnouncementType.EVENT
  })
    announcementType!: AnnouncementType;

  @Column({ nullable: true })
    date?: Date;

  @Column({ nullable: true })
    time?: string;

  @Column({ nullable: true })
    location?: string;

  @Column({ default: 0 })
    points!: number;

  @Column({ default: 0 })
    membersLimit!: number;

  @Column({ nullable: true })
    scheduleDate?: Date;

  @Column({ default: false })
    isOfflineStallExist!: boolean;

  // ✅ Embedded stall configuration (only relevant when isOfflineStallExist = true)
  @Column({ nullable: true })
    stallConfig?: StallConfig;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
