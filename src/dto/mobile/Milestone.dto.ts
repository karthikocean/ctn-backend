import { IsString, IsOptional } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateMilestoneDto:
 *       type: object
 *       properties:
 *         mediaUrl:
 *           type: string
 *           example: "https://example.com/milestone.jpg"
 *         caption:
 *           type: string
 *           example: "Completed 5 years in business!"
 *     UpdateMilestoneDto:
 *       type: object
 *       properties:
 *         mediaUrl:
 *           type: string
 *         caption:
 *           type: string
 */

export class CreateMilestoneDto {
  @IsString()
  @IsOptional()
    mediaUrl?: string;

  @IsString()
  @IsOptional()
    caption?: string;
}

export class UpdateMilestoneDto {
  @IsString()
  @IsOptional()
    mediaUrl?: string;

  @IsString()
  @IsOptional()
    caption?: string;
}
