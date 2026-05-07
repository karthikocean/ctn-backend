import {
  IsString,
  IsEmail,
  IsOptional,
  IsNumber,
  IsArray,
  Length,
  IsNotEmpty
} from "class-validator";

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
    userId!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
    pin!: string;
}
