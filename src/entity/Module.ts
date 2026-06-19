import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("modules")
@Index(["slugName"], { unique: true })
export class Module {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    name!: string;

  @Column()
    slugName!: string;

  @Column({ nullable: true, default: null })
    parentSlug!: string | null;   // e.g. "categories" for Main/Sub/Referral Categories

  @Column({ default: 0 })
    sortOrder!: number;           // controls sidebar ordering within a parent

  @Column({ default: 1 })
    isActive!: number;

  @Column({ default: 0 })
    isDelete!: number;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
