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
@Index(["senderId", "receiverId"])
@Index(["senderId"])
@Index(["receiverId"])
@Index(["status"])
@Index(["isDeleted"])
@Index(["senderId", "status", "isDeleted"])
@Index(["receiverId", "status", "isDeleted"])
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

  @Column({ default: false })
    isDeleted: boolean = false;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
