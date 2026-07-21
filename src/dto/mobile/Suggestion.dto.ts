import { IsString, IsNotEmpty, IsOptional, MaxLength, MinLength } from "class-validator";

export class CreateSuggestionDto {
  @IsString()
  @IsOptional({ message: "Title is required" })
  @MinLength(3, { message: "Title must be at least 3 characters" })
  @MaxLength(150, { message: "Title cannot exceed 150 characters" })
    title!: string;

  @IsString()
  @IsNotEmpty({ message: "Description is required" })
  @MinLength(10, { message: "Description must be at least 10 characters" })
  @MaxLength(2000, { message: "Description cannot exceed 2000 characters" })
    description!: string;

  @IsOptional()
  @IsString()
    image?: string;
}

export class UpdateSuggestionDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: "Title must be at least 3 characters" })
  @MaxLength(150, { message: "Title cannot exceed 150 characters" })
    title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: "Description must be at least 10 characters" })
  @MaxLength(2000, { message: "Description cannot exceed 2000 characters" })
    description?: string;

  @IsOptional()
  @IsString()
    image?: string;
}

export class UpdateSuggestionStatusDto {
  @IsString()
  @IsNotEmpty({ message: "Status is required" })
    status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "Admin note cannot exceed 500 characters" })
    adminNote?: string;
}
