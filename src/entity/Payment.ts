import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("payments")
export class Payment {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column({ nullable: true })
    subscriptionId?: ObjectId;

  @Column()
    planId!: ObjectId;

  @Column()
    amount!: number;

  @Column()
    paymentMethod!: string;

  @Column()
    transactionId!: string;

  @Column({ default: "PENDING" })
    status!: string; // "PENDING" | "COMPLETED" | "FAILED"

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
