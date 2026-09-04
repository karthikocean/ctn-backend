import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("cities")
@Index(["name", "stateId", "isDeleted"])
@Index(["stateId", "isDeleted"])
@Index(["name"])
export class City {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    stateId!: ObjectId;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ default: "active" })
    status?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
