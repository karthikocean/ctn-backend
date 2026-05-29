import { IsNotEmpty, IsDateString } from "class-validator";

export class ApproveSpotlightRequestDto {
  @IsDateString()
  @IsNotEmpty()
    scheduleDate!: string;
}
