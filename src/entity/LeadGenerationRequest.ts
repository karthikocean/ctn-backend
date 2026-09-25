import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

export enum LeadGenerationStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED"
}

@Entity("lead_generation_requests")
@Index(["userId", "createdAt"])
@Index(["userId", "status", "createdAt"])
@Index(["parentGenerationId"])
@Index(["userId", "isDeleted"])
export class LeadGenerationRequest {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    userId!: string;

  @Column("simple-array")
    businessNames!: string[];

  @Column("simple-array")
    locations!: string[];

  @Column({ nullable: true })
    additionalRequirement?: string;

  @Column()
    generatedPrompt!: string;

  @Column({ default: "1.0" })
    promptVersion!: string;

  @Column()
    provider!: string;

  @Column()
    model!: string;

  @Column({
    type: "enum",
    enum: LeadGenerationStatus,
    default: LeadGenerationStatus.PENDING
  })
    status!: LeadGenerationStatus;

  @Column({ nullable: true })
    rawAIResponse?: any;

  @Column({ nullable: true })
    rawAIText?: string;

  @Column({ default: 0 })
    leadCount!: number;

  @Column({ nullable: true })
    errorMessage?: string;

  @Column({ nullable: true })
    metadata?: Record<string, any>;

  @Column({ default: 1 })
    version!: number;

  @Column({ nullable: true })
    parentGenerationId?: string;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
