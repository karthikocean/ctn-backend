import { Entity, ObjectIdColumn, Column, CreateDateColumn, Index } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("verifications")
export class Verification {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
  @Index()
    identifier!: string; // email or phone number

  @Column()
    type!: string; // "email" or "phone"

  @Column()
    otp!: string;

  @Column({ type: "datetime" })
    expiresAt!: Date;

  @Column({ default: false })
    isVerified!: boolean;

  @CreateDateColumn()
    createdAt!: Date;
}
