import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

export enum MarketplaceCategoryStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

@Entity("marketplace_categories")
export class MarketplaceCategory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column({
    type: "enum",
    enum: MarketplaceCategoryStatus,
    default: MarketplaceCategoryStatus.ACTIVE
  })
    status!: MarketplaceCategoryStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
