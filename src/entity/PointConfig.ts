import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum PointConfigType {
  CREATION = "creation",
  RESPONSE = "response"
}

@Entity("point_configs")
@Index(["moduleName", "type"], { unique: true })
export class PointConfig {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    moduleName!: string;

  @Column({
    type: "enum",
    enum: PointConfigType,
    default: PointConfigType.CREATION
  })
    type!: PointConfigType;

  @Column({ type: "number", default: 0 })
    points!: number;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
