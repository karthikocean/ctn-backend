import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum SupportStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  RESOLVED = "RESOLVED",
  CLOSED = "CLOSED"
}

@Entity("supports")
@Index(["phone"])
@Index(["email"])
@Index(["status"])
@Index(["isActive"])
@Index(["isDeleted"])
@Index(["createdAt"])
export class Support {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    phone!: string;

  @Column({ nullable: true })
    email?: string;

  @Column({ nullable: true })
    companyName?: string;

  @Column({ nullable: true })
    category?: string;

  @Column({ nullable: true })
    description?: string;

  @Column({
    type: "enum",
    enum: SupportStatus,
    default: SupportStatus.PENDING
  })
    status!: SupportStatus;

  @Column({ default: true })
    isActive: boolean = true;

  @Column({ default: false })
    isDeleted: boolean = false;

  @Column({ nullable: true })
    updatedBy?: ObjectId | string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
