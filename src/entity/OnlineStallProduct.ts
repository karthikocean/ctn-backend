import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("online_stall_products")
@Index(["eventId"])
@Index(["memberId"])
@Index(["eventId", "memberId"])
export class OnlineStallProduct {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    productName!: string;

  @Column({ nullable: true })
    description?: string;

  @Column({ type: "number", default: 0 })
    price!: number;

  @Column("simple-array", { nullable: true })
    images?: string[];

  @Column()
    memberId!: ObjectId;

  @Column()
    eventId!: ObjectId;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
