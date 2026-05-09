import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

export enum PostType {
  PROMOTION = "PROMOTION",
  GIVE = "GIVE",
  ASK = "ASK",
  REQUIREMENT = "REQUIREMENT"
}

@Entity("posts")
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

  @Column({ default: false })
  isDeleted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
