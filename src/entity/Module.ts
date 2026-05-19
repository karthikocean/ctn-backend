import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("modules")
export class Module {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column({ default: 1 })
    isActive!: number;

  @Column({ default: 0 })
    isDelete!: number;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
