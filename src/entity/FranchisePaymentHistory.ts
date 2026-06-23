import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("franchise_payment_histories")
export class FranchisePaymentHistory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    franchiseId!: ObjectId;

  @Column()
    month!: string; // format "YYYY-MM"

  @Column({ default: "pending" })
    status!: string; // "pending" | "settled"

  @Column({ nullable: true })
    paymentReceiptUrl?: string;

  @Column({ nullable: true })
    settledAt?: Date;

  @Column({ nullable: true })
    settledBy?: ObjectId;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
