import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum ConnectionStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  BLOCKED = "BLOCKED",
  CANCELLED = "CANCELLED"
}

@Entity("connections")
@Index(["senderId", "receiverId"], { unique: true })
export class Connection {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    senderId!: ObjectId;

  @Column()
    receiverId!: ObjectId;

  @Column({
    type: "enum",
    enum: ConnectionStatus,
    default: ConnectionStatus.PENDING
  })
    status!: ConnectionStatus;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
