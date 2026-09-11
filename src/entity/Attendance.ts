import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

export enum AttendanceStatus {
  PRESENT = "present",
  ABSENT = "absent",
  LATE = "late"
}

@Entity("attendances")
@Index(["eventId"])
@Index(["announcementId"])
@Index(["memberId"])
@Index(["eventId", "memberId"], { unique: true })
@Index(["date"])
export class Attendance {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    eventId!: ObjectId;

  @Column({ nullable: true })
    announcementId?: ObjectId;

  @Column({ nullable: true })
    bookingId?: ObjectId;

  @Column()
    date!: Date;

  @Column({ nullable: true })
    checkInTime?: string;

  @Column({
    type: "enum",
    enum: AttendanceStatus,
    default: AttendanceStatus.PRESENT
  })
    status!: AttendanceStatus;

  @Column({ nullable: true })
    markedBy?: ObjectId;

  @Column({ nullable: true })
    remarks?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
