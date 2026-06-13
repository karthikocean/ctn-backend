import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsOptional,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";

class ModuleConfigDto {
  @IsString()
  @IsNotEmpty()
    moduleName!: string;

  @IsNumber()
    countLimit!: number;

  @IsString()
  @IsOptional()
    frequency?: string;

  @IsNumber()
  @IsOptional()
    frequencyValue?: number;
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
    trialDays?: number | null;

  @IsString()
  @IsOptional()
    status?: string = "active";

  @IsString()
  @IsOptional()
    billingCycle?: string = "yearly";

  @IsString()
  @IsOptional()
    billingType?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleConfigDto)
    modules!: ModuleConfigDto[];
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
    trialDays?: number | null;

  @IsString()
  @IsOptional()
    status?: string;

  @IsString()
  @IsOptional()
    billingCycle?: string;

  @IsString()
  @IsOptional()
    billingType?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ModuleConfigDto)
    modules?: ModuleConfigDto[];
}
