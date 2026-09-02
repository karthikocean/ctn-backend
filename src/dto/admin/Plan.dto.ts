import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsOptional,
  IsBoolean,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";

export class ModuleConfigDto {
  @IsString()
  @IsNotEmpty()
    moduleName!: string;

  @IsNumber()
    countLimit!: number;

  @IsString()
    frequency!: string;

  @IsNumber()
    frequencyValue!: number;
}

export class FeatureConfigDto {
  @IsBoolean()
  @IsOptional()
    monthlyMeeting?: boolean;

  @IsBoolean()
  @IsOptional()
    eventVisitor?: boolean;

  @IsBoolean()
  @IsOptional()
    eventStall?: boolean;

  @IsBoolean()
  @IsOptional()
    spotlights?: boolean;
}

export class BenefitConfigDto {
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    marketplaceProductLimit?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    requirementResponseLimit?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    pointMultiplier?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    trainingDiscountPercentage?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    referralBonusMonths?: number;
}

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty({ message: "Plan title is required" })
    title!: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsNumber()
    amount!: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    percentage?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    offerPrice?: number;

  @IsNumber()
  @IsOptional()
    trialDays?: number = 0;

  @IsString()
  @IsOptional()
    status?: "active" | "inactive" = "active";

  @IsString()
    billingType!: string;

  @IsString()
  @IsOptional()
    billingCycle?: string = "yearly";

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleConfigDto)
    modules!: ModuleConfigDto[];

  @ValidateNested()
  @Type(() => FeatureConfigDto)
    features!: FeatureConfigDto;

  @ValidateNested()
  @Type(() => BenefitConfigDto)
    benefits!: BenefitConfigDto;

  @IsNumber()
  @IsOptional()
    sort?: number = 0;
}

export class UpdatePlanDto {
  @IsString()
  @IsOptional()
    title?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsNumber()
  @IsOptional()
    amount?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    percentage?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
    offerPrice?: number;

  @IsNumber()
  @IsOptional()
    trialDays?: number;

  @IsString()
  @IsOptional()
    status?: "active" | "inactive";

  @IsString()
  @IsOptional()
    billingType?: string;

  @IsString()
  @IsOptional()
    billingCycle?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ModuleConfigDto)
    modules?: ModuleConfigDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FeatureConfigDto)
    features?: FeatureConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BenefitConfigDto)
    benefits?: BenefitConfigDto;

  @IsNumber()
  @IsOptional()
    sort?: number;
}
