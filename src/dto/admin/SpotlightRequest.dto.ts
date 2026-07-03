import { IsNotEmpty, IsDateString, IsOptional, IsString } from "class-validator";

export class ApproveSpotlightRequestDto {
  @IsDateString()
  @IsNotEmpty()
    scheduleDate!: string;

  @IsString()
  @IsOptional()
    status?: string;
}
