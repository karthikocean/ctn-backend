import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  IsDateString
} from "class-validator";
import { Type } from "class-transformer";
import { EventStatus } from "../../entity/Event";

export class CreateEventDto {
  @IsString()
  @IsNotEmpty({ message: "Title is required" })
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Type(() => Date)
  @IsNotEmpty({ message: "Date is required" })
    date!: Date;

  @IsString()
  @IsNotEmpty({ message: "Time is required" })
  time!: string;

  @IsString()
  @IsNotEmpty({ message: "Location is required" })
  location!: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsString()
  @IsOptional()
  video?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  points?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  membersLimit?: number;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus = EventStatus.UPCOMING;
}

export class UpdateEventDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Type(() => Date)
  @IsOptional()
    date?: Date;

  @IsString()
  @IsOptional()
  time?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsString()
  @IsOptional()
  video?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  points?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  membersLimit?: number;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;
}
