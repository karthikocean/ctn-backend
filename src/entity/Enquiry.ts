import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum EnquiryStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  RESOLVED = "RESOLVED",
  REJECTED = "REJECTED"
}

@Entity("enquiries")
@Index(["email"])
@Index(["phoneNumber"])
@Index(["status"])
@Index(["isDeleted"])
@Index(["createdAt"])
export class Enquiry {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    email!: string;

  @Column()
    phoneNumber!: string;

  @Column({ nullable: true })
    enquiryType?: string;

  @Column({ nullable: true })
    city?: string;

  @Column({ nullable: true })
    companyName?: string;

  @Column({ nullable: true })
    comment?: string;

  @Column({
    type: "enum",
    enum: EnquiryStatus,
    default: EnquiryStatus.PENDING
  })
    status!: EnquiryStatus;

  @Column({ nullable: true })
    adminNote?: string;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
