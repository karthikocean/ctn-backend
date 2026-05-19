import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

export enum TrainingCategoryStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

@Entity("training_categories")
export class TrainingCategory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column({
    type: "enum",
    enum: TrainingCategoryStatus,
    default: TrainingCategoryStatus.ACTIVE
  })
    status!: TrainingCategoryStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
