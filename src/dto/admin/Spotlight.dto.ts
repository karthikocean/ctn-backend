import {
  IsArray,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsDateString,
  IsMongoId
} from "class-validator";
import { SpotlightStatus } from "../../entity/Spotlight";

export class CreateSpotlightDto {
  @IsArray()
  @IsNotEmpty()
    members!: string[]; // Array of Member IDs as strings

  @IsDateString()
  @IsNotEmpty()
    scheduleDate!: string;

  @IsEnum(SpotlightStatus)
  @IsOptional()
    status?: SpotlightStatus = SpotlightStatus.SCHEDULE;
}

export class UpdateSpotlightDto {
  @IsArray()
  @IsOptional()
    members?: string[];

  @IsDateString()
  @IsOptional()
    scheduleDate?: string;

  @IsEnum(SpotlightStatus)
  @IsOptional()
    status?: SpotlightStatus;
}
