import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray
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
}
