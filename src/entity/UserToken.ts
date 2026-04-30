import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("user_tokens")
export class UserToken {

    @Column() companyId!: ObjectId;
    @ObjectIdColumn()
      _id!: ObjectId;

    @Column()
      userId!: ObjectId;

    @Column()
      userType!: "ADMIN" | "ADMIN_USER" | "MEMBER";

    @Column()
      token!: string;

    @CreateDateColumn()
      createdAt!: Date;

    @UpdateDateColumn()
      updatedAt!: Date;
}
