import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export enum EventStatus {
  UPCOMING = "upcoming",
  ONGOING = "ongoing",
  COMPLETED = "completed",
  CANCELLED = "cancelled"
}

@Entity("events")
export class Event {
    @ObjectIdColumn()
      _id!: ObjectId;

    @Column()
      title!: string;

    @Column({ nullable: true })
      description?: string;

    @Column()
      date!: Date;

    @Column()
      time!: string;

    @Column()
      location!: string;

    @Column({ nullable: true })
      image?: string; // URL from media upload

    @Column({ nullable: true })
      video?: string; // URL from media upload

    @Column({ default: 0 })
      points!: number;

    @Column({ default: 0 })
      membersLimit!: number;

    @Column({
      type: "enum",
      enum: EventStatus,
      default: EventStatus.UPCOMING
    })
      status!: EventStatus;

    @Column({ default: false })
      isDeleted!: boolean;

    @CreateDateColumn()
      createdAt!: Date;

    @UpdateDateColumn()
      updatedAt!: Date;
}
