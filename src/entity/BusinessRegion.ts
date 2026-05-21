import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
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
export class BusinessRegion {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    country!: string;

  @Column()
    state!: string;

  @Column()
    city!: string;

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
