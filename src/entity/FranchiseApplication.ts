import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum FranchiseApplicationStatus {
  PENDING = "PENDING",
  UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED"
}

@Entity("franchise_applications")
@Index(["email"])
@Index(["phoneNumber"])
@Index(["state"])
@Index(["city"])
@Index(["status"])
@Index(["isDeleted"])
@Index(["createdAt"])
export class FranchiseApplication {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    fullName!: string;

  @Column()
    phoneNumber!: string;

  @Column()
    email!: string;

  @Column()
    state!: string;

  @Column()
    city!: string;

  @Column()
    companyName!: string;

  @Column({
    type: "enum",
    enum: FranchiseApplicationStatus,
    default: FranchiseApplicationStatus.PENDING
  })
    status!: FranchiseApplicationStatus;

  @Column({ nullable: true })
    adminNote?: string;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
