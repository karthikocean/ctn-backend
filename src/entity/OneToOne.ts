import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("one_to_ones")
@Index(["senderId"])
@Index(["receiverId"])
export class OneToOne {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    senderId!: ObjectId;

  @Column()
    receiverId!: ObjectId;

  @Column({ nullable: true })
    media?: string[];

  @Column({ nullable: true })
    status?: string;

  @Column({ nullable: true })
    reason?: string;

  @Column({ nullable: true })
    conversationId?: ObjectId;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
