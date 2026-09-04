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
  DIRECT_MEET = "DIRECT_MEET",
  RECOMMENDATIONS = "RECOMMENDATIONS",
  BUSINESS_DONE = "BUSINESS_DONE",
  POST_SHARE = "POST_SHARE",
  MILESTONE_REPLY = "MILESTONE_REPLY",
  PRODUCT_RESPONSE = "PRODUCT_RESPONSE",
  REMINDER = "REMINDER"
}

@Entity("messages")
@Index(["conversationId"])
@Index(["senderId"])
@Index(["createdAt"])
@Index(["conversationId", "isDeleted", "createdAt"])
@Index(["conversationId", "createdAt"])
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

  @Column({ nullable: true })
    productId?: ObjectId; // Reference to product if it's a PRODUCT_RESPONSE

  @Column({ nullable: true })
    milestoneId?: ObjectId; // Reference to milestone if it's a MILESTONE_REPLY

  @Column({ nullable: true })
    reminderId?: ObjectId; // Reference to reminder if it's a REMINDER

  @Column({ default: false })
    isRead!: boolean;

  @Column({ default: false })
    isEdited!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    blockedFor?: ObjectId[]; // List of user IDs for whom this message was blocked/undelivered

  @Column({ nullable: true })
    replyToMessageId?: ObjectId; // Reference to the message being replied to

  @Column({ nullable: true })
    media?: string[]; // For IMAGE or DIRECT_MEET types

  @Column({ nullable: true })
    businessActionId?: ObjectId; // Link to DirectMeet, Recommendations, BusinessDone, or Reminder record

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
