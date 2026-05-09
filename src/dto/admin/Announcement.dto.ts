import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional
} from "class-validator";
import { AnnouncementStatus } from "../../entity/Announcement";

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
}
