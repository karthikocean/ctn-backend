import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("announcement_bookings")
@Index(["announcementId"])
@Index(["memberId"])
@Index(["announcementId", "memberId"])
export class AnnouncementBooking {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    announcementId!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({ type: "number", default: 0 })
    pointsSpent!: number;

  @Column({ default: "booked" })
    status!: string; // "booked" | "cancelled"

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
