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

export enum LocationVisibility {
  EVERYONE = "EVERYONE",
  FOLLOWERS = "FOLLOWERS",
  MUTUAL = "MUTUAL"
}

export interface ServiceLocation {
  country: string;
  states: string[];
  cities: string[];
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
    businessType?: string;

  @Column({ nullable: true })
    legalName?: string;

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
    businessRegion?: ObjectId | null;

  @Column({ type: "json", nullable: true })
    serviceLocations?: ServiceLocation;

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
    instagram?: string;

  @Column({ nullable: true })
    faceBook?: string;

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
    planId?: ObjectId;

  @Column({ nullable: true })
    subscriptionId?: ObjectId;

  @Column({ nullable: true })
    subscriptionStartDate?: Date;

  @Column({ nullable: true })
    subscriptionEndDate?: Date;

  @Column({ default: false })
    hasUsedTrial!: boolean;

  @Column({ nullable: true })
    createdBy?: ObjectId;

  @Column({ nullable: true })
    updatedBy?: ObjectId;

  @Exclude()
  @Column({ nullable: true })
    fcmToken?: string;

  @Column({ default: 0 })
    points!: number;

  @Column({ default: 0 })
    dailyScore!: number;

  @Column({ default: false })
    isOnline!: boolean;

  @Column({ nullable: true })
    lastSeen?: Date;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;

  @Column({ nullable: true })
    latitude?: number;

  @Column({ nullable: true })
    longitude?: number;

  @Column({
    type: "enum",
    enum: LocationVisibility,
    default: LocationVisibility.EVERYONE
  })
    locationVisibility!: LocationVisibility;

  @Column({ nullable: true })
    dob?: Date;
}
