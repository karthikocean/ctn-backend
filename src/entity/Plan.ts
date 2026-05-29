import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("plans")
export class Plan {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    title!: string;

  @Column()
    description!: string;

  @Column()
    amount!: number;

  @Column({ default: "active" })
    status!: string;

  @Column("simple-json")
    modules!: {
    moduleName: string;
    countLimit: number;
    frequency: string;
    frequencyValue: number;
  }[];

  @Column({ default: false })
    isDeleted!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
