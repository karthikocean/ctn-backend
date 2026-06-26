import { IsString, IsOptional, IsNumber, IsBoolean } from "class-validator";
import { Type } from "class-transformer";

export class ReminderListDto {
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    page?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    limit?: number;

  @IsString()
  @IsOptional()
    search?: string;

  @IsString()
  @IsOptional()
    module?: string;

  @IsString()
  @IsOptional()
    status?: string;

  @IsString()
  @IsOptional()
    fromDate?: string;

  @IsString()
  @IsOptional()
    toDate?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
    isActive?: boolean;
}
