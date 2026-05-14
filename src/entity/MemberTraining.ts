import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("member_trainings")
@Index(["memberId", "trainingId"], { unique: true })
export class MemberTraining {
  @ObjectIdColumn()
  _id!: ObjectId;

  @Column()
  memberId!: ObjectId;

  @Column()
  trainingId!: ObjectId;

  @Column({ nullable: true })
  lessonId?: ObjectId;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
