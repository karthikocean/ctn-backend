import { 
  IsString, 
  IsNotEmpty, 
  IsEnum, 
  IsOptional, 
  IsMongoId, 
  ValidateIf 
} from "class-validator";
import { CategoryType, CategoryStatus } from "../../entity/Category";

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
    name!: string;

  @IsEnum(CategoryType)
  @IsNotEmpty()
    type!: CategoryType;

  @ValidateIf(o => o.type === CategoryType.SUB)
  @IsMongoId()
  @IsNotEmpty()
    parentCategory?: string;

  @ValidateIf(o => o.type === CategoryType.REFERRAL)
  @IsMongoId()
  @IsNotEmpty()
    referralParent?: string;

  @IsEnum(CategoryStatus)
  @IsOptional()
    status?: CategoryStatus = CategoryStatus.ACTIVE;
}

export class UpdateCategoryDto {
  @IsString()
  @IsOptional()
    name?: string;

  @IsEnum(CategoryStatus)
  @IsOptional()
    status?: CategoryStatus;

  @IsMongoId()
  @IsOptional()
    parentCategory?: string;

  @IsMongoId()
  @IsOptional()
    referralParent?: string;
}
