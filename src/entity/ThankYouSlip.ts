import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("thank_you_slips")
@Index(["senderId"])
@Index(["receiverId"])
export class ThankYouSlip {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    senderId!: ObjectId; // Person who gave the TY Slip

  @Column()
    receiverId!: ObjectId; // Person who received the TY Slip

  @Column()
    amount!: number;

  @Column({ nullable: true })
    businessDetails?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
