import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("saved_posts")
@Index(["memberId"])
@Index(["postId"])
@Index(["memberId", "postId"], { unique: true })
export class SavedPost {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    postId!: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;
}
