import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum
} from "class-validator";
import { SupportStatus } from "../../entity/Support";

export class CreateSupportDto {
  @IsString()
  @IsNotEmpty({ message: "Name is required" })
    name!: string;

  @IsString()
  @IsNotEmpty({ message: "Phone is required" })
    phone!: string;

  @IsString()
  @IsOptional()
    email?: string;

  @IsString()
  @IsOptional()
    companyName?: string;

  @IsString()
  @IsOptional()
    category?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsEnum(SupportStatus)
  @IsOptional()
    status?: SupportStatus;

  @IsBoolean()
  @IsOptional()
    isActive?: boolean;
}

export class UpdateSupportDto {
  @IsString()
  @IsOptional()
    name?: string;

  @IsString()
  @IsOptional()
    phone?: string;

  @IsString()
  @IsOptional()
    email?: string;

  @IsString()
  @IsOptional()
    companyName?: string;

  @IsString()
  @IsOptional()
    category?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsEnum(SupportStatus)
  @IsOptional()
    status?: SupportStatus;

  @IsBoolean()
  @IsOptional()
    isActive?: boolean;

  @IsOptional()
    updatedBy?: string;
}
