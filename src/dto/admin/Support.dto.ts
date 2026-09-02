import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNotEmpty
} from "class-validator";
import { SupportStatus } from "../../entity/Support";

export class UpdateSupportStatusDto {
  @IsEnum(SupportStatus)
  @IsNotEmpty({ message: "Status is required" })
    status!: SupportStatus;

  @IsBoolean()
  @IsOptional()
    isActive?: boolean;

  @IsString()
  @IsOptional()
    adminNote?: string;
}

export class AdminUpdateSupportDto {
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

  @IsString()
  @IsOptional()
    adminNote?: string;
}
