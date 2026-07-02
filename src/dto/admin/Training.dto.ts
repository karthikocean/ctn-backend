import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsBoolean
} from "class-validator";
import { Type } from "class-transformer";
import { TrainingStatus } from "../../entity/Training";

class LessonDto {
  @IsOptional()
    _id?: any;

  @IsString()
  @IsNotEmpty()
    title!: string;

  @IsString()
  @IsNotEmpty()
    description!: string;

  @IsString()
  @IsNotEmpty()
    thumbnail!: string;

  @IsString()
  @IsNotEmpty()
    videoUrl!: string;

  @IsNumber()
  @IsNotEmpty()
    points!: number;

  @IsString()
  @IsNotEmpty()
    duration!: string;
}

export class CreateTrainingDto {
  @IsString()
  @IsNotEmpty()
    title!: string;

  @IsString()
  @IsNotEmpty()
    description!: string;

  @IsString()
  @IsNotEmpty()
    thumbnail!: string;

  @IsString()
  @IsNotEmpty()
    banner!: string;

  @IsNumber()
  @IsNotEmpty()
    overallPoints!: number;

  @IsEnum(TrainingStatus)
  @IsOptional()
    status?: TrainingStatus = TrainingStatus.ACTIVE;

  @IsString()
  @IsNotEmpty()
    authorName!: string;

  @IsString()
  @IsNotEmpty()
    authorImage!: string;

  @IsString()
  @IsNotEmpty()
    authorBio!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LessonDto)
    lessons!: LessonDto[];

  @IsString()
  @IsOptional()
    categoryId?: string;

  @IsBoolean()
  @IsOptional()
    isFree?: boolean;
}

export class UpdateTrainingDto {
  @IsString()
  @IsOptional()
    title?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsString()
  @IsOptional()
    thumbnail?: string;

  @IsString()
  @IsOptional()
    banner?: string;

  @IsNumber()
  @IsOptional()
    overallPoints?: number;

  @IsEnum(TrainingStatus)
  @IsOptional()
    status?: TrainingStatus;

  @IsString()
  @IsOptional()
    authorName?: string;

  @IsString()
  @IsOptional()
    authorImage?: string;

  @IsString()
  @IsOptional()
    authorBio?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LessonDto)
    lessons?: LessonDto[];

  @IsString()
  @IsOptional()
    categoryId?: string;

  @IsBoolean()
  @IsOptional()
    isFree?: boolean;
}
