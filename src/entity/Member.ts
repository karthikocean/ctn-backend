import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

export enum MemberStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  BLOCKED = "blocked"
}

export enum CompanySize {
  SIZE_1_10 = "1-10",
  SIZE_11_50 = "11-50",
  SIZE_51_100 = "51-100",
  SIZE_101_500 = "101-500",
  SIZE_500_PLUS = "500+"
}

@Entity("members")
@Index(["mobileNumber"], { unique: true })
@Index(["email"], { unique: true, sparse: true })
export class Member {
  @ObjectIdColumn()
    _id!: ObjectId;

  // =========================================
  // BASIC INFORMATION
  // =========================================
  @Column()
    pin!: string;

  @Column()
    fullName!: string;

  @Column({ nullable: true })
    profilePhoto?: string;

  @Column()
    mobileNumber!: string;

  @Column({ default: false })
    mobileVerified!: boolean;

  @Column({ nullable: true })
    email?: string;

  @Column({ default: false })
    emailVerified!: boolean;

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
    subCategory?: ObjectId;

  @Column({ nullable: true })
    yearsOfExperience?: number;

  @Column({
    type: "enum",
    enum: CompanySize,
    nullable: true
  })
    companySize?: CompanySize;

  // =========================================
  // LOCATION DETAILS
  // =========================================

  @Column({ nullable: true })
    city?: string;

  @Column({ nullable: true })
    businessAddress?: string;

  @Column("simple-array", { nullable: true })
    serviceLocations?: string[];

  // =========================================
  // PROFESSIONAL DETAILS
  // =========================================

  @Column({ nullable: true })
    productsServicesDescription?: string;

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

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
