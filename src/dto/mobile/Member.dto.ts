import {
  IsString,
  IsEmail,
  IsOptional,
  IsNumber,
  IsArray,
  Length,
  IsNotEmpty,
  IsEnum,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";
import { LocationVisibility } from "../../entity/Member";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateMemberDto:
 *       type: object
 *       required:
 *         - fullName
 *         - mobileNumber
 *       properties:
 *         fullName:
 *           type: string
 *           example: "John Doe"
 *         mobileNumber:
 *           type: string
 *           example: "9876543210"
 *         email:
 *           type: string
 *           example: "john@example.com"
 *         businessName:
 *           type: string
 *           example: "Doe Enterprises"
 *         profilePhoto:
 *           type: string
 *           example: "https://example.com/photo.jpg"
 *         profileBanner:
 *           type: string
 *           example: "https://example.com/banner.jpg"
 *         gstNumber:
 *           type: string
 *         businessCategory:
 *           type: string
 *         subCategory:
 *           type: string
 *         city:
 *           type: string
 *         yearsOfExperience:
 *           type: integer
 *         dob:
 *           type: string
 *           example: "28-06-2000"
 *     UpdateProfileDto:
 *       type: object
 *       properties:
 *         fullName:
 *           type: string
 *         email:
 *           type: string
 *         businessName:
 *           type: string
 *         city:
 *           type: string
 *         profilePhoto:
 *           type: string
 *         profileBanner:
 *           type: string
 *         businessCategory:
 *           type: string
 *         subCategory:
 *           type: string
 *         yearsOfExperience:
 *           type: integer
 *         fcmToken:
 *           type: string
 *     SetPinDto:
 *       type: object
 *       required:
 *         - userId
 *         - pin
 *       properties:
 *         userId:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         pin:
 *           type: string
 *           example: "1234"
 *     UpdateLocationDto:
 *       type: object
 *       required:
 *         - latitude
 *         - longitude
 *         - locationVisibility
 *       properties:
 *         latitude:
 *           type: number
 *           example: 12.9237
 *         longitude:
 *           type: number
 *           example: 80.1428
 *         locationVisibility:
 *           type: string
 *           enum: [EVERYONE, FOLLOWERS, MUTUAL]
 *           example: "EVERYONE"
 *     CheckLocationDto:
 *       type: object
 *       required:
 *         - latitude
 *         - longitude
 *       properties:
 *         latitude:
 *           type: number
 *           example: 12.9237
 *         longitude:
 *           type: number
 *           example: 80.1428
 */

export class ServiceLocationDto {
  @IsString()
  @IsNotEmpty()
    country!: string;

  @IsArray()
  @IsString({ each: true })
    states!: string[];

  @IsArray()
  @IsString({ each: true })
    cities!: string[];
}

export class CreateMemberDto {
  @IsString()
  @IsOptional()
    dob?: string;

  @IsString()
    fullName!: string;

  @IsString()
    mobileNumber!: string;

  @IsEmail()
  @IsOptional()
    email?: string;

  @IsString()
  @IsOptional()
    gstNumber?: string;

  @IsString()
  @IsOptional()
    businessName?: string;

  @IsString()
  @IsOptional()
    businessType?: string;

  @IsString()
  @IsOptional()
    legalName?: string;

  @IsString()
  @IsOptional()
    businessCategory?: string;

  @IsString()
  @IsOptional()
    subCategory?: string;

  @IsNumber()
  @IsOptional()
    yearsOfExperience?: number;

  @IsString()
  @IsOptional()
    companySize?: string;

  @IsString()
  @IsOptional()
    state?: string;

  @IsString()
  @IsOptional()
    city?: string;

  @IsString()
  @IsOptional()
    businessAddress?: string;

  @IsString()
  @IsOptional()
    businessRegion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceLocationDto)
    serviceLocations?: ServiceLocationDto;

  @IsString()
  @IsOptional()
    productsServicesDescription?: string;

  @IsArray()
  @IsOptional()
    productsServices?: { title: string; image: string; description: string }[];

  @IsString()
  @IsOptional()
    targetAudience?: string;

  @IsString()
  @IsOptional()
    websiteUrl?: string;

  @IsString()
  @IsOptional()
    linkedinProfile?: string;

  @IsString()
  @IsOptional()
    instagram?: string;
  @IsString()
  @IsOptional()
    faceBook?: string;
  @IsString()
  @IsOptional()
    youtubeLink?: string;

  @IsString()
  @IsOptional()
    profilePhoto?: string;

  @IsString()
  @IsOptional()
    profileBanner?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    workImages?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    certifications?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    businessDocuments?: string[];
}

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
    fullName?: string;

  @IsEmail()
  @IsOptional()
    email?: string;

  @IsString()
  @IsOptional()
  @Length(4, 4)
    pin?: string;

  @IsString()
  @IsOptional()
    businessName?: string;

  @IsString()
  @IsOptional()
    businessType?: string;

  @IsString()
  @IsOptional()
    legalName?: string;

  @IsNumber()
  @IsOptional()
    yearsOfExperience?: number;

  @IsString()
  @IsOptional()
    companySize?: string;

  @IsString()
  @IsOptional()
    state?: string;

  @IsString()
  @IsOptional()
    city?: string;
  @IsString()
  @IsOptional()
    businessCategory?: string;

  @IsString()
  @IsOptional()
    subCategory?: string;

  @IsString()
  @IsOptional()
    businessAddress?: string;

  @IsString()
  @IsOptional()
    businessRegion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceLocationDto)
    serviceLocations?: ServiceLocationDto;

  @IsString()
  @IsOptional()
    productsServicesDescription?: string;

  @IsArray()
  @IsOptional()
    productsServices?: { title: string; image: string; description: string }[];

  @IsString()
  @IsOptional()
    targetAudience?: string;

  @IsString()
  @IsOptional()
    websiteUrl?: string;

  @IsString()
  @IsOptional()
    linkedinProfile?: string;

  @IsString()
  @IsOptional()
    instagram?: string;

  @IsString()
  @IsOptional()
    faceBook?: string;

  @IsString()
  @IsOptional()
    youtubeLink?: string;

  @IsString()
  @IsOptional()
    profilePhoto?: string;

  @IsString()
  @IsOptional()
    profileBanner?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    workImages?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    certifications?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    businessDocuments?: string[];

  @IsString()
  @IsOptional()
    fcmToken?: string;
  @IsString()
  @IsOptional()
    dob?: string;
}

export class SetPinDto {
  @IsString()
  @IsNotEmpty()
    userId!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
    pin!: string;
}

export class UpdateLocationDto {
  @IsNumber()
  @IsNotEmpty()
    latitude!: number;

  @IsNumber()
  @IsNotEmpty()
    longitude!: number;

  @IsEnum(LocationVisibility)
  @IsNotEmpty()
    locationVisibility!: LocationVisibility;
}

export class CheckLocationDto {
  @IsNumber()
  @IsNotEmpty()
    latitude!: number;

  @IsNumber()
  @IsNotEmpty()
    longitude!: number;
}

export class UpdateFcmTokenDto {
  @IsString()
  @IsNotEmpty()
    fcmToken!: string;
}

