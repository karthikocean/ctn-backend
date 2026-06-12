import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("subscription_feature_usages")
export class SubscriptionFeatureUsage {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    subscriptionId!: ObjectId;

  @Column()
    featureType!: string; // "connections_created" | "messages_sent"

  @Column({ default: 0 })
    count!: number;

  @Column()
    resetDate!: Date;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
