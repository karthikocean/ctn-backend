import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("incomplete_registrations")
@Index(["mobileNumber"])
@Index(["email"])
@Index(["isDeleted"])
@Index(["createdAt"])
@Index(["mobileNumber", "isDeleted"])
export class IncompleteRegistration {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    fullName!: string;

  @Column()
    mobileNumber!: string;

  @Column({ nullable: true })
    email?: string;

  // The registration step the user dropped off at (e.g. "basic_info", "business_info", "verify_otp")
  @Column({ nullable: true })
    step?: string;

  @Column({ nullable: true })
    deviceInfo?: string;

  @Column({ nullable: true })
    fcmToken?: string;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
