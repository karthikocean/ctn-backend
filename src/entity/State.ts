import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("states")
export class State {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    country!: string;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
