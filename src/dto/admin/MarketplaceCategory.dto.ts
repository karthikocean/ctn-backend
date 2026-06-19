import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean
} from "class-validator";
import { MarketplaceCategoryStatus } from "../../entity/MarketplaceCategory";

export class CreateMarketplaceCategoryDto {
  @IsString()
  @IsNotEmpty({ message: "Name is required" })
    name!: string;

  @IsEnum(MarketplaceCategoryStatus)
  @IsOptional()
    status?: MarketplaceCategoryStatus = MarketplaceCategoryStatus.ACTIVE;
}

export class UpdateMarketplaceCategoryDto {
  @IsString()
  @IsOptional()
    name?: string;

  @IsEnum(MarketplaceCategoryStatus)
  @IsOptional()
    status?: MarketplaceCategoryStatus;
}

export class UpdateMarketplaceCategoryStatusDto {
  @IsBoolean()
  @IsNotEmpty({ message: "Status is required" })
    isActive!: boolean;
}
