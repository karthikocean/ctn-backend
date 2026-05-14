import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";
import { Exclude } from "class-transformer";

export enum MemberStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  BLOCKED = "blocked"
}

@Entity("members")
@Index(["mobileNumber"], { unique: true })
@Index(["email"], { unique: true, sparse: true })
@Index(["status"])
@Index(["isDeleted"])
export class Member {
  @ObjectIdColumn()
    _id!: ObjectId;

  // =========================================
  // BASIC INFORMATION
  // =========================================
  @Exclude()
  @Column()
    pin!: string;

  @Column()
    fullName!: string;

  @Column({ nullable: true })
    profilePhoto?: string;

  @Column({ nullable: true })
    profileBanner?: string;

  @Column()
    mobileNumber!: string;

  @Column({ default: false })
    mobileVerified!: boolean;

  @Column({ nullable: true })
    email?: string;

  @Column({ default: false })
    emailVerified!: boolean;

  @Column({ nullable: true })
    about?: string;

  @Column({ default: "BASIC" })
    membershipType!: string;

  // =========================================
  // BUSINESS INFORMATION
  // =========================================

  @Column({ nullable: true })
    gstNumber?: string;

  @Column({ default: false })
    gstVerified!: boolean;

  @Column({ nullable: true })
    businessName?: string;

  @Column({ nullable: true })
    businessCategory?: ObjectId;

  @Column({ nullable: true })
    industry?: string;

  @Column({ nullable: true })
    subCategory?: ObjectId;

  @Column({ nullable: true })
    yearsOfExperience?: number;

  @Column({ nullable: true })
    companySize?: string;

  // =========================================
  // LOCATION DETAILS
  // =========================================

  @Column({ nullable: true })
    state?: string;

  @Column({ nullable: true })
    city?: string;

  @Column({ nullable: true })
    businessAddress?: string;

  @Column({ nullable: true })
    areas?: string;

  @Column("simple-array", { nullable: true })
    serviceLocations?: string[];

  // =========================================
  // PROFESSIONAL DETAILS
  // =========================================

  @Column({ nullable: true })
    productsServicesDescription?: string;

  @Column("json", { nullable: true })
    productsServices?: { title: string; image: string; description: string }[];

  @Column({ nullable: true })
    targetAudience?: string;

  // =========================================
  // PORTFOLIO & PROOF
  // =========================================

  @Column("simple-array", { nullable: true })
    workImages?: string[];

  @Column("simple-array", { nullable: true })
    certifications?: string[];

  @Column("simple-array", { nullable: true })
    businessDocuments?: string[];

  // =========================================
  // SOCIAL LINKS
  // =========================================

  @Column({ nullable: true })
    websiteUrl?: string;

  @Column({ nullable: true })
    linkedinProfile?: string;

  @Column({ nullable: true })
    instagramFacebook?: string;

  @Column({ nullable: true })
    youtubeLink?: string;

  // =========================================
  // SYSTEM FIELDS
  // =========================================

  @Column({
    type: "enum",
    enum: MemberStatus,
    default: MemberStatus.ACTIVE
  })
    status!: MemberStatus;

  @Column({ default: false })
    isDeleted!: boolean;

  @Column({ nullable: true })
    createdBy?: ObjectId;

  @Column({ nullable: true })
    updatedBy?: ObjectId;

  @Exclude()
  @Column({ nullable: true })
    fcmToken?: string;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
