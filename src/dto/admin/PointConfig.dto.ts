import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsEnum } from "class-validator";
import { PointConfigType } from "../../entity/PointConfig";

export class CreatePointConfigDto {
  @IsString()
  @IsNotEmpty({ message: "Module name is required" })
  moduleName!: string;

  @IsEnum(PointConfigType, { message: "Type must be either creation or response" })
  @IsNotEmpty({ message: "Type is required" })
  type!: PointConfigType;

  @IsNumber()
  @Min(0, { message: "Points cannot be negative" })
  points!: number;
}

export class UpdatePointConfigDto {
  @IsString()
  @IsOptional()
  moduleName?: string;

  @IsEnum(PointConfigType, { message: "Type must be either creation or response" })
  @IsOptional()
  type?: PointConfigType;

  @IsNumber()
  @Min(0, { message: "Points cannot be negative" })
  @IsOptional()
  points?: number;
}
