import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  IsBoolean,
  ValidateNested,
  IsArray
} from "class-validator";
import { Type } from "class-transformer";
import { AnnouncementStatus, AnnouncementType } from "../../entity/Announcement";

export class StallItemDto {
  @IsString()
  @IsOptional()
    _id?: string;

  @IsString()
  @IsNotEmpty()
    name!: string;

  @IsString()
  @IsOptional()
    size!: string;

  @IsNumber({}, { message: "Points must be a valid number" })
  @Min(0, { message: "Points cannot be negative" })
    points!: number;
}

export class StallConfigDto {
  @IsNumber()
  @IsOptional()
  @Min(0)
    totalStallCount!: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StallItemDto)
    stalls!: StallItemDto[];
}

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty({ message: "Title is required" })
    title!: string;

  @IsString()
  @IsNotEmpty({ message: "Content is required" })
    content!: string;

  @IsString()
  @IsNotEmpty({ message: "Image is required" })
    image!: string;

  @IsString()
  @IsOptional()
    video?: string;

  @IsEnum(AnnouncementStatus)
  @IsOptional()
    status?: AnnouncementStatus = AnnouncementStatus.DRAFT;

  @IsEnum(AnnouncementType)
  @IsOptional()
    announcementType?: AnnouncementType = AnnouncementType.EVENT;

  @Type(() => Date)
  @IsOptional()
    date?: Date;

  @IsString()
  @IsOptional()
    time?: string;

  @IsString()
  @IsOptional()
    location?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
    points?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
    membersLimit?: number;

  @Type(() => Date)
  @IsOptional()
    scheduleDate?: Date;

  @IsBoolean()
  @IsOptional()
    isOfflineStallExist?: boolean = false;

  // ✅ Stall configuration — provided when isOfflineStallExist = true
  @IsOptional()
  @ValidateNested()
  @Type(() => StallConfigDto)
    stallConfig?: StallConfigDto;
}

export class UpdateAnnouncementDto {
  @IsString()
  @IsOptional()
    title?: string;

  @IsString()
  @IsOptional()
    content?: string;

  @IsString()
  @IsOptional()
    image?: string;

  @IsString()
  @IsOptional()
    video?: string;

  @IsEnum(AnnouncementStatus)
  @IsOptional()
    status?: AnnouncementStatus;

  @IsEnum(AnnouncementType)
  @IsOptional()
    announcementType?: AnnouncementType;

  @Type(() => Date)
  @IsOptional()
    date?: Date;

  @IsString()
  @IsOptional()
    time?: string;

  @IsString()
  @IsOptional()
    location?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
    points?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
    membersLimit?: number;

  @Type(() => Date)
  @IsOptional()
    scheduleDate?: Date;

  @IsBoolean()
  @IsOptional()
    isOfflineStallExist?: boolean;

  // ✅ Stall configuration — sent when saving stall details for an announcement
  @IsOptional()
  @ValidateNested()
  @Type(() => StallConfigDto)
    stallConfig?: StallConfigDto;
}
