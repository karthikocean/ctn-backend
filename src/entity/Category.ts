import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum CategoryType {
  MAIN = "MAIN",
  SUB = "SUB",
  REFERRAL = "REFERRAL"
}

export enum CategoryStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

@Entity("categories")
@Index(["name", "type"], { unique: true })
export class Category {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column({
    type: "enum",
    enum: CategoryType,
    default: CategoryType.MAIN
  })
    type!: CategoryType;

  @Column({ nullable: true })
    parentCategory?: ObjectId; // For SUB categories

  @Column({ nullable: true })
    referralParent?: ObjectId; // For REFERRAL categories

  @Column({
    type: "enum",
    enum: CategoryStatus,
    default: CategoryStatus.ACTIVE
  })
    status!: CategoryStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
