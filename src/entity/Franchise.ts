import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum FranchiseStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

@Entity("franchises")
@Index(["name"])
@Index(["status"])
@Index(["isDeleted"])
export class Franchise {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    businessRegionId!: ObjectId;

  @Column()
    userId!: ObjectId[]; // Array of member IDs (users)

  @Column({
    type: "enum",
    enum: FranchiseStatus,
    default: FranchiseStatus.ACTIVE
  })
    status!: FranchiseStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
