import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional
} from "class-validator";
import { TrainingCategoryStatus } from "../../entity/TrainingCategory";

export class CreateTrainingCategoryDto {
  @IsString()
  @IsNotEmpty()
    name!: string;

  @IsEnum(TrainingCategoryStatus)
  @IsOptional()
    status?: TrainingCategoryStatus = TrainingCategoryStatus.ACTIVE;
}

export class UpdateTrainingCategoryDto {
  @IsString()
  @IsOptional()
    name?: string;

  @IsEnum(TrainingCategoryStatus)
  @IsOptional()
    status?: TrainingCategoryStatus;
}
