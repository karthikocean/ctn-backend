import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("plans")
export class Plan {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    title!: string;

  @Column({ nullable: true })
    description?: string;

  @Column()
    amount!: number;

  @Column({ default: "active" })
    status!: string;

  @Column({ nullable: true })
    trialDays?: number | null;

  @Column({ nullable: true })
    type?: string; // "FREE" | "TRIAL" | "PREMIUM" | "BUSINESS"

  @Column({ nullable: true, default: "yearly" })
    billingCycle?: string = "yearly"; // "monthly" | "yearly" | "none"

  @Column({ nullable: true })
    billingType?: string; // "basic" | "standard" | "premium"

  @Column("json", { nullable: true })
    features?: {
      maxConnections: number; // -1 for unlimited
      maxMessages: number;    // -1 for unlimited
      searchType: string;     // "basic" | "advanced"
      requirementsAccess: string; // "public" | "premium"
      featuredProfile: boolean;
      priorityVisibility: boolean;
      trustAnalytics: boolean;
      businessInsights: boolean;
      teamManagement: boolean;
      leadGeneration: boolean;
      dashboard: boolean;
      premiumBranding: boolean;
    };

  @Column("simple-json")
    modules!: {
    moduleName: string;
    countLimit: number;
    frequency: string;
    frequencyValue: number;
  }[];

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
