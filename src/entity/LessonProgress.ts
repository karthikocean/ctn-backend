import {
  Entity,
  ObjectIdColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("lesson_progress")
@Index(["memberId", "trainingId", "lessonId"], { unique: true })
export class LessonProgress {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    memberId!: ObjectId;

  @Column()
    trainingId!: ObjectId;

  @Column()
    lessonId!: ObjectId;

  @Column({ type: "float", default: 0 })
    lastWatchedPosition!: number; // in seconds or percentage

  @Column({ default: false })
    isCompleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
