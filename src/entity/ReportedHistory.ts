import { Entity, ObjectIdColumn, Column, CreateDateColumn } from "typeorm";
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

  @CreateDateColumn()
    createdAt!: Date;
}
