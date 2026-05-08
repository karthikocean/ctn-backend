import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export enum AnnouncementStatus {
  DRAFT = "draft",
  PUBLISHED = "published"
}

@Entity("announcements")
export class Announcement {
    @ObjectIdColumn()
      _id!: ObjectId;

    @Column()
      title!: string;

    @Column()
      content!: string;

    @Column({ nullable: true })
      image?: string; // URL from media upload

    @Column({ nullable: true })
      video?: string; // URL from media upload

    @Column({
      type: "enum",
      enum: AnnouncementStatus,
      default: AnnouncementStatus.DRAFT
    })
      status!: AnnouncementStatus;

    @Column({ default: false })
      isDeleted!: boolean;

    @CreateDateColumn()
      createdAt!: Date;

    @UpdateDateColumn()
      updatedAt!: Date;
}
