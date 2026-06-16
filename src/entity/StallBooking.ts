import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("stall_bookings")
@Index(["announcementId", "stallId"])
@Index(["memberId"])
export class StallBooking {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    announcementId!: ObjectId;

  @Column()
    stallId!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({ type: "number" })
    pointsSpent!: number;

  @Column({ default: "booked" })
    status!: string; // "booked" | "cancelled"

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
