import { Entity, ObjectIdColumn, Column, CreateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("email_verifications")
export class EmailVerification {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
  @Index()
    email!: string;

  @Column()
    otp!: string;

  @Column({ type: "datetime" })
    expiresAt!: Date;

  @Column({ default: false })
    isVerified!: boolean;

  @CreateDateColumn()
    createdAt!: Date;
}
