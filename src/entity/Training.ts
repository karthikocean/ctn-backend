import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

export enum TrainingStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

export interface Lesson {
  _id?: ObjectId;
  title: string;
  description: string;
  thumbnail: string;
  videoUrl: string;
  points: number;
  duration: string;
}

@Entity("trainings")
export class Training {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column({ nullable: true })
    categoryId?: ObjectId;

  @Column()
    title!: string;

  @Column()
    description!: string;

  @Column()
    thumbnail!: string;

  @Column()
    banner!: string;

  @Column()
    overallPoints!: number;

  @Column({
    type: "enum",
    enum: TrainingStatus,
    default: TrainingStatus.ACTIVE
  })
    status!: TrainingStatus;

  @Column()
    authorName!: string;

  @Column()
    authorImage!: string;

  @Column()
    authorBio!: string;

  @Column("json")
    lessons!: Lesson[];

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
