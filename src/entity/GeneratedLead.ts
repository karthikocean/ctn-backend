import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("generated_leads")
@Index(["generationId", "createdAt"])
@Index(["userId", "normalizedBusinessName"])
@Index(["userId", "normalizedWebsite"])
@Index(["generationId", "isDeleted"])
export class GeneratedLead {
  @ObjectIdColumn()
  _id!: ObjectId;

  @Column()
  generationId!: string;

  @Column()
  userId!: string;

  @Column()
  businessName!: string;

  @Column()
  normalizedBusinessName!: string;

  @Column({ nullable: true })
  category?: string;

  @Column("simple-array")
  locations!: string[];

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  normalizedWebsite?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  confidenceScore?: number;

  @Column({ nullable: true })
  sourceMetadata?: Record<string, any>;

  @Column({ default: false })
  isDeleted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
