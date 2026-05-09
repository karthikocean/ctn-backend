import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("point_configs")
@Index(["moduleName"], { unique: true })
export class PointConfig {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    moduleName!: string;

  @Column({ type: "number", default: 0 })
    points!: number;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
