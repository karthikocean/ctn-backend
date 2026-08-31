import { IsOptional, IsString, IsNumber, IsEnum } from "class-validator";
import { Type } from "class-transformer";

export enum ReferralActivityFilter {
  ALL = "all",
  HAS_REFERRALS = "has_referrals",
  NO_REFERRALS = "no_referrals",
  WAS_REFERRED = "was_referred",
  DIRECT = "direct"
}

export class AdminReferralListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
    page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
    limit?: number = 10;

  @IsOptional()
  @IsString()
    search?: string;

  @IsOptional()
  @IsString()
    category?: string;

  @IsOptional()
  @IsEnum(ReferralActivityFilter)
    referralFilter?: ReferralActivityFilter;

  @IsOptional()
  @IsString()
    status?: string;

  @IsOptional()
  @IsString()
    startDate?: string;

  @IsOptional()
  @IsString()
    endDate?: string;

  @IsOptional()
  @IsString()
    sortBy?: string;
}
