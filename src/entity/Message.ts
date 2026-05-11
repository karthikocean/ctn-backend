import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum MessageType {
  TEXT = "TEXT",
  POST_RESPONSE = "POST_RESPONSE",
  IMAGE = "IMAGE",
  ONE_TO_ONE = "ONE_TO_ONE",
  REFERRAL = "REFERRAL",
  THANK_YOU_SLIP = "THANK_YOU_SLIP",
  POST_SHARE = "POST_SHARE"
}

@Entity("messages")
@Index(["conversationId"])
@Index(["senderId"])
@Index(["createdAt"])
export class Message {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    conversationId!: ObjectId;

  @Column()
    senderId!: ObjectId;

  @Column()
    content!: string;

  @Column({
    type: "enum",
    enum: MessageType,
    default: MessageType.TEXT
  })
    type!: MessageType;

  @Column({ nullable: true })
    postId?: ObjectId; // Reference to post if it's a POST_RESPONSE

  @Column({ default: false })
    isRead!: boolean;

  @Column({ default: false })
    isEdited!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    replyToMessageId?: ObjectId; // Reference to the message being replied to

  @Column({ nullable: true })
    media?: string[]; // For IMAGE or ONE_TO_ONE types

  @Column({ nullable: true })
    businessActionId?: ObjectId; // Link to OneToOne, Referral, or ThankYouSlip record

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
