import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray
} from "class-validator";
import { BusinessRegionStatus } from "../../entity/BusinessRegion";

export class CreateBusinessRegionDto {
  @IsString()
  @IsNotEmpty()
    country!: string;

  @IsString()
  @IsNotEmpty()
    state!: string;

  @IsString()
  @IsNotEmpty()
    city!: string;

  @IsEnum(BusinessRegionStatus)
  @IsOptional()
    status?: BusinessRegionStatus = BusinessRegionStatus.ACTIVE;

  @IsArray()
  @IsOptional()
    areas?: any[];
}

export class UpdateBusinessRegionDto {
  @IsString()
  @IsOptional()
    country?: string;

  @IsString()
  @IsOptional()
    state?: string;

  @IsString()
  @IsOptional()
    city?: string;

  @IsEnum(BusinessRegionStatus)
  @IsOptional()
    status?: BusinessRegionStatus;

  @IsArray()
  @IsOptional()
    areas?: any[];
}
