import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("conversations")
@Index(["participants"])
@Index(["postId"])
@Index(["productId"])
export class Conversation {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    participants!: ObjectId[]; // Array of member IDs

  @Column({ nullable: true })
    postId?: ObjectId; // Reference to the specific post this chat is about

  @Column({ nullable: true })
    productId?: ObjectId; // Reference to the specific online stall product this chat is about

  @Column({ nullable: true })
    milestoneId?: ObjectId; // Reference to the specific milestone this chat is about

  @Column({ nullable: true })
    lastMessage?: string;

  @Column({ nullable: true })
    lastMessageTime?: Date;

  @Column({ nullable: true })
    lastMessageSenderId?: ObjectId;

  @Column({ default: "PENDING" })
    status!: string; // PENDING, USEFUL, MAY_BE_LATER, REJECTED, REPORTED

  @Column({ nullable: true })
    reportedBy?: ObjectId;

  @Column({ nullable: true })
    reportReason?: string;

  @Column({ default: {} })
    unreadCounts!: any; // Map of userId string to unread count

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
