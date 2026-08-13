import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";
import { ReferralStatus } from "./Referral";

export enum ContactType {
  MYSELF = "myself",
  REFERRED = "referred"
}

@Entity("contacts")
@Index(["createdBy"])
@Index(["isActive"])
@Index(["isDeleted"])
export class Contact {
  @ObjectIdColumn()
  _id!: ObjectId;

  @Column()
  name!: string;

  @Column()
  phoneNumber!: string;

  @Column({
    type: "enum",
    enum: ContactType,
    default: ContactType.MYSELF
  })
  type!: ContactType;

  @Column({ nullable: true })
  referredBy?: ObjectId;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  isDeleted!: boolean;

  @Column({
    type: "enum",
    enum: ReferralStatus,
    default: ReferralStatus.NOT_CONTACTED
  })
  status!: ReferralStatus;

  @Column()
  createdBy!: ObjectId;

  @Column({ nullable: true })
  modifiedBy?: ObjectId;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
