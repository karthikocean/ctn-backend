import {
  IsString,
  IsNotEmpty,
  IsOptional
} from "class-validator";

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
    name!: string;

  @IsString()
  @IsOptional()
    parentSlug?: string;
}

export class UpdateModuleDto {
  @IsString()
  @IsOptional()
    name?: string;

  @IsString()
  @IsOptional()
    parentSlug?: string;
}
