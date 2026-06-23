import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

export type BillingCycleType = "monthly" | "yearly" | "none";
export type BillingPlanType = "basic" | "standard" | "premium" | "enterprise";
export type FrequencyType = "daily" | "weekly" | "monthly" | "yearly";

export interface PlanModuleConfig {
  moduleName: string;
  countLimit: number; // -1 represents unlimited usage
  frequency: FrequencyType;
  frequencyValue: number;
}

export interface PlanFeatureConfig {
  monthlyMeeting: boolean;
  eventVisitor: boolean;
  eventStall: boolean;
  spotlights: boolean;
}

export interface PlanBenefitConfig {
  requirementResponseLimit: number;
  pointMultiplier: number; // e.g. 1, 2
  trainingDiscountPercentage: number;
  referralBonusMonths: number;
}

@Entity("plans")
export class Plan {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    title!: string;

  @Column({ nullable: true })
    description?: string;

  @Column({ type: "number" })
    amount!: number;

  @Column({ default: "active" })
    status!: "active" | "inactive";

  @Column({ type: "number", default: 0 })
    trialDays!: number;

  @Column({ nullable: true })
    type?: string; // KEEP to prevent database mapping breaks for legacy fields

  @Column()
    billingType!: BillingPlanType;

  @Column({ default: "yearly" })
    billingCycle!: BillingCycleType;

  @Column("json")
    modules!: PlanModuleConfig[];

  @Column("json")
    features!: PlanFeatureConfig;

  @Column("json")
    benefits!: PlanBenefitConfig;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}

