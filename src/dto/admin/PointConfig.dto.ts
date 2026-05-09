import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from "class-validator";

export class CreatePointConfigDto {
  @IsString()
  @IsNotEmpty({ message: "Module name is required" })
    moduleName!: string;

  @IsNumber()
  @Min(0, { message: "Points cannot be negative" })
    points!: number;
}

export class UpdatePointConfigDto {
  @IsString()
  @IsOptional()
    moduleName?: string;

  @IsNumber()
  @Min(0, { message: "Points cannot be negative" })
  @IsOptional()
    points?: number;
}
