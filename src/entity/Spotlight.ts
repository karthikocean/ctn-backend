import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

export enum SpotlightStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  DRAFT = "draft",
  SCHEDULE = "schedule"
}

@Entity("spotlights")
export class Spotlight {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    members!: ObjectId[];

  @Column()
    scheduleDate!: Date;

  @Column({
    type: "enum",
    enum: SpotlightStatus,
    default: SpotlightStatus.SCHEDULE
  })
    status!: SpotlightStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    createdBy?: ObjectId;

  @Column({ nullable: true })
    updatedBy?: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
