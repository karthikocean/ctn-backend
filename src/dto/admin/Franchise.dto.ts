import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  Max
} from "class-validator";
import { FranchiseStatus } from "../../entity/Franchise";

export class CreateFranchiseDto {
  @IsString()
  @IsNotEmpty()
    name!: string;

  @IsString()
  @IsNotEmpty()
    businessRegionId!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    userId?: string[];

  @IsEnum(FranchiseStatus)
  @IsOptional()
    status?: FranchiseStatus = FranchiseStatus.ACTIVE;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
    commissionPercentage?: number = 0;
}

export class UpdateFranchiseDto {
  @IsString()
  @IsOptional()
    name?: string;

  @IsString()
  @IsOptional()
    businessRegionId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    userId?: string[];

  @IsEnum(FranchiseStatus)
  @IsOptional()
    status?: FranchiseStatus;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
    commissionPercentage?: number;
}
