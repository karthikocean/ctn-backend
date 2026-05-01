import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("roles")
@Index(["code"], { unique: true }) // scoped unique
@Index(["name"], { unique: true }) // scoped unique
export class Role {

  @ObjectIdColumn()
    _id!: ObjectId;

  // @Column()
  //   companyId!: ObjectId;

  @Column()
    name!: string;

  @Column()
    code!: string;

  @Column({ nullable: true })
    description?: string;

  @Column({ default: true })
    isActive!: boolean;

  @Column({ default: false })
    isDeleted!: boolean;

  // @Column({ default: false })
  // showForAdmin!: boolean;

  // @Column({ default: false })
  // mobileAdminAccess!: boolean;

  /**
   * Flexible permissions structure
   * Supports dynamic actions
   */
  @Column("json")
    permissions!: {
    moduleId: String;
    actions: string[]; // ["view", "create", "edit", "delete"]
  }[];

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;

  @Column({ nullable: true })
    createdBy?: ObjectId;

  @Column({ nullable: true })
    updatedBy?: ObjectId;
}
