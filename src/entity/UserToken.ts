import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("user_tokens")
export class UserToken {

    @Column({ nullable: true })
      companyId?: ObjectId;
    @ObjectIdColumn()
      _id!: ObjectId;

    @Column()
      userId!: ObjectId;

    @Column()
      token!: string;

    @CreateDateColumn()
      createdAt!: Date;

    @UpdateDateColumn()
      updatedAt!: Date;
}
