import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray
} from "class-validator";
import { Type } from "class-transformer";
import { BlogStatus } from "../../entity/Blog";

export class CreateBlogDto {
  @IsString()
  @IsNotEmpty({ message: "Title is required" })
    title!: string;

  @IsString()
  @IsNotEmpty({ message: "Slug is required" })
    slug!: string;

  @Type(() => Date)
  @IsNotEmpty({ message: "Publish date is required" })
    publishDate!: Date;

  @IsEnum(BlogStatus)
  @IsOptional()
    status?: BlogStatus = BlogStatus.ACTIVE;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    images?: string[];

  @IsString()
  @IsOptional()
    metaTitle?: string;

  @IsString()
  @IsOptional()
    metaKeywords?: string;

  @IsString()
  @IsOptional()
    metaDescription?: string;

  @IsString()
  @IsOptional()
    shortDescription?: string;

  @IsString()
  @IsOptional()
    description?: string;
}

export class UpdateBlogDto {
  @IsString()
  @IsOptional()
    title?: string;

  @IsString()
  @IsOptional()
    slug?: string;

  @Type(() => Date)
  @IsOptional()
    publishDate?: Date;

  @IsEnum(BlogStatus)
  @IsOptional()
    status?: BlogStatus;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    images?: string[];

  @IsString()
  @IsOptional()
    metaTitle?: string;

  @IsString()
  @IsOptional()
    metaKeywords?: string;

  @IsString()
  @IsOptional()
    metaDescription?: string;

  @IsString()
  @IsOptional()
    shortDescription?: string;

  @IsString()
  @IsOptional()
    description?: string;
}
