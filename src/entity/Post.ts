import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum PostType {
  PROMOTION = "PROMOTION",
  GIVE = "GIVE",
  ASK = "ASK",
  REQUIREMENT = "REQUIREMENT"
}

export enum RequirementVisibility {
  MUTUAL_FRIEND = "MUTUAL-FRIEND",
  REGION = "REGION",
  OVERALL = "OVERALL"
}

@Entity("posts")
@Index(["memberId"])
@Index(["type"])
@Index(["isDeleted"])
@Index(["createdAt"])
export class PostModel {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column({
    type: "enum",
    enum: PostType,
    default: PostType.REQUIREMENT
  })
    type!: PostType;

  @Column()
    title!: string;

  @Column()
    description!: string;

  @Column({ nullable: true })
    location?: string;

  @Column({ nullable: true })
    period?: string;

  @Column("simple-array", { nullable: true })
    media?: string[];

  @Column()
    memberId!: ObjectId;

  @Column({ default: 0 })
    responsedCount!: number;

  @Column({ default: 0 })
    sharedCount!: number;

  @Column({ nullable: true })
    stateIds?: ObjectId[];

  @Column({ nullable: true })
    regionIds?: ObjectId[];

  @Column({ nullable: true })
    categoryIds?: ObjectId[];

  @Column({ nullable: true })
    subCategoryIds?: ObjectId[];

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ default: true })
    isActive!: boolean;

  @Column({ default: "active" })
    status!: string;

  @Column({
    type: "enum",
    enum: RequirementVisibility,
    nullable: true
  })
    requirementVisibility?: RequirementVisibility;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
