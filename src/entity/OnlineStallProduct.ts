import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("online_stall_products")
@Index(["memberId"])
@Index(["isDeleted"])
@Index(["memberId", "isDeleted"])
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

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ type: "string", nullable: true })
    location?: "region" | "Overall";

  @Column({ type: "date", nullable: true })
    endDate?: Date;

  @Column({ nullable: true })
    marketplaceCategory?: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
