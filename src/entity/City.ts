import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("cities")
export class City {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    stateId!: ObjectId;

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
