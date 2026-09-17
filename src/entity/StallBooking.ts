import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("stall_bookings")
@Index(["announcementId", "stallId"])
@Index(["memberId"])
@Index(["announcementId", "memberId"])
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

  @Column({ nullable: true })
    paymentId?: ObjectId;

  @Column({ type: "number", nullable: true })
    amountPaid?: number;

  @Column({ default: "points" })
    paymentMethod!: string; // "points" | "razorpay"

  @Column({ nullable: true })
    transactionId?: string;

  @Column({ default: "booked" })
    status!: string; // "booked" | "cancelled"

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
