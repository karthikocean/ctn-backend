import { IsString, IsNotEmpty, IsOptional } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     UpdateSlipStatusDto:
 *       type: object
 *       required:
 *         - id
 *         - status
 *       properties:
 *         id:
 *           type: string
 *           description: ID of the slip (Direct Meet, Recommendations, or Business Done)
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         type:
 *           type: string
 *           description: "Optional slip type: DIRECT_MEET, RECOMMENDATIONS, BUSINESS_DONE. Auto-detected if omitted."
 *           example: "RECOMMENDATIONS"
 *         status:
 *           type: string
 *           description: "New status value (e.g., PENDING, CONVERTED, CLOSED, ACCEPTED, REJECTED, COMPLETED)"
 *           example: "CONVERTED"
 *         reason:
 *           type: string
 *           description: "Optional reason for the status update"
 *           example: "Business transaction completed successfully"
 */
export class UpdateSlipStatusDto {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsNotEmpty()
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
