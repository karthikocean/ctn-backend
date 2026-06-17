import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ObjectId } from "mongodb";

export enum CouponStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

export enum DiscountType {
  PERCENTAGE = "percentage",
  FIXED = "fixed"
}

@Entity("coupons")
export class Coupon {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    code!: string;

  @Column({ nullable: true })
    description?: string;

  @Column({
    type: "enum",
    enum: DiscountType,
    default: DiscountType.PERCENTAGE
  })
    discountType!: DiscountType;

  @Column()
    discountValue!: number;

  @Column({ default: 0 })
    minOrderAmount!: number;

  @Column({ default: 0 })
    maxDiscountAmount!: number;

  @Column({ nullable: true })
    startDate?: Date;

  @Column()
    endDate!: Date;

  @Column({ nullable: true })
    usageLimit?: number;

  @Column({ default: 1 })
    perUserLimit!: number;

  @Column({ default: 0 })
    usedCount!: number;

  @Column({
    type: "enum",
    enum: CouponStatus,
    default: CouponStatus.ACTIVE
  })
    status!: CouponStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    createdBy?: ObjectId;

  @Column({ nullable: true })
    updatedBy?: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
