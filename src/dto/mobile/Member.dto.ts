import {
  IsString,
  IsEmail,
  IsOptional,
  IsNumber,
  IsArray,
  Length,
  IsNotEmpty
} from "class-validator";

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
 */

export class CreateMemberDto {
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
    city?: string;

  @IsString()
  @IsOptional()
    businessAddress?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    serviceLocations?: string[];

  @IsString()
  @IsOptional()
    productsServicesDescription?: string;

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
    instagramFacebook?: string;

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

  @IsNumber()
  @IsOptional()
    yearsOfExperience?: number;

  @IsString()
  @IsOptional()
    companySize?: string;

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

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    serviceLocations?: string[];

  @IsString()
  @IsOptional()
    productsServicesDescription?: string;

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
    instagramFacebook?: string;

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
