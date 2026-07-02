import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

export enum SpotlightRequestStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected"
}

@Entity("spotlight_requests")
export class SpotlightRequest {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({
    type: "enum",
    enum: SpotlightRequestStatus,
    default: SpotlightRequestStatus.PENDING
  })
    status!: SpotlightRequestStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    reason?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
