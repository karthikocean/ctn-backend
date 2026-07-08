import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

export enum SpotlightHistoryAction {
  REQUEST_CREATED = "pending",
  REQUEST_APPROVED = "approved",
  REQUEST_REJECTED = "rejected",
  ASSIGNED = "assigned"
}

@Entity("spotlight_histories")
export class SpotlightHistory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({
    type: "enum",
    enum: SpotlightHistoryAction
  })
    action!: SpotlightHistoryAction;

  @Column({ nullable: true })
    scheduleDate?: Date;

  @Column({ nullable: true })
    reason?: string;

  @Column({ nullable: true })
    performedBy?: ObjectId;

  @Column({ nullable: true })
    moduleId?: ObjectId;

  @Column({ nullable: true })
    msg?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
