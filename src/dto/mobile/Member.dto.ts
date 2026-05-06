import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsUrl,
} from "class-validator";
import { CompanySize } from "../../entity/Member";

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
}
