// src/entity/LoginHistory.ts
import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("loginhistories")
export class LoginHistory {

    @Column() companyId!: ObjectId;

  @ObjectIdColumn()
    id!: ObjectId;

  @Column()
    userId!: ObjectId;

  @Column()
    userType!: "ADMIN" | "ADMIN_USER" |"MEMBER" | "GUEST";

  @Column()
    userName!: string;

  @Column()
    phoneNumber!: string;

  @Column()
    deviceName!: string;

  @Column()
    browserName!: string;

  @Column()
    currentLocation!: string;

  @Column()
    ipAddress!: string;

  @Column()
    loginfrom!: "WEB" | "MOBILE";

  @Column()
    status!: "SUCCESS" | "FAILED";

  @CreateDateColumn()
    loginAt!: Date;
}
