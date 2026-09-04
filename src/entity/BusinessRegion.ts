import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum BusinessRegionStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

export interface Area {
  _id: ObjectId;
  name: string;
}

@Entity("business_regions")
@Index(["state", "city", "isDeleted"])
@Index(["areas"])
export class BusinessRegion {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    country!: string;

  @Column()
    state!: ObjectId;

  @Column()
    city!: ObjectId;

  @Column("json", { nullable: true })
    areas?: Area[];

  @Column({
    type: "enum",
    enum: BusinessRegionStatus,
    default: BusinessRegionStatus.ACTIVE
  })
    status!: BusinessRegionStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
