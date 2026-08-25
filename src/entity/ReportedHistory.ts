import { Entity, ObjectIdColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ObjectId } from "mongodb";

@Entity("reported_history")
export class ReportedHistory {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    reporterUserId!: ObjectId; // Report panna vanga (Reporter)

  @Column()
    targetUserId!: ObjectId; // Yaar mela report aacho avanga (Target)

  @Column()
    moduleName!: string;

  @Column()
    reason!: string;

  @Column({ default: "REPORTED" })
    status!: "REPORTED" | "UNREPORTED";

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    unreportedAt?: Date;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
