import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ObjectId } from "mongodb";

export enum BlogStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

@Entity("blogs")
export class Blog {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    title!: string;

  @Column()
    slug!: string;

  @Column()
    publishDate!: Date;

  @Column({
    type: "enum",
    enum: BlogStatus,
    default: BlogStatus.ACTIVE
  })
    status!: BlogStatus;

  @Column({ type: "array", default: [] })
    images!: string[];

  @Column({ nullable: true })
    metaTitle?: string;

  @Column({ nullable: true })
    metaKeywords?: string;

  @Column({ nullable: true })
    metaDescription?: string;

  @Column({ nullable: true })
    shortDescription?: string;

  @Column({ nullable: true })
    description?: string;

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
