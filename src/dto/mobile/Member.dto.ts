import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsUrl,
  Length,
  IsNotEmpty
} from "class-validator";
import { CompanySize } from "../../entity/Member";

export class CreateMemberDto {
  @IsString()
    fullName!: string;

  @IsString()
    mobileNumber!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
    pin!: string;

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

  @IsEnum(CompanySize)
  @IsOptional()
    companySize?: CompanySize;

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

  @IsUrl()
  @IsOptional()
    websiteUrl?: string;

  @IsUrl()
  @IsOptional()
    linkedinProfile?: string;

  @IsUrl()
  @IsOptional()
    instagramFacebook?: string;

  @IsUrl()
  @IsOptional()
    youtubeLink?: string;

  @IsString()
  @IsOptional()
    profilePhoto?: string;

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
  @Length(6, 6)
    pin?: string;

  @IsString()
  @IsOptional()
    businessName?: string;

  @IsNumber()
  @IsOptional()
    yearsOfExperience?: number;

  @IsEnum(CompanySize)
  @IsOptional()
    companySize?: CompanySize;

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

  @IsUrl()
  @IsOptional()
    websiteUrl?: string;

  @IsUrl()
  @IsOptional()
    linkedinProfile?: string;

  @IsUrl()
  @IsOptional()
    instagramFacebook?: string;

  @IsUrl()
  @IsOptional()
    youtubeLink?: string;

  @IsString()
  @IsOptional()
    profilePhoto?: string;

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

export class SetPinDto {
  @IsString()
  @IsNotEmpty()
    mobileNumber!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
    pin!: string;
}
