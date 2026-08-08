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
 *           description: ID of the slip (121, Referral, or ThankYouSlip)
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         type:
 *           type: string
 *           description: "Optional slip type: ONE_TO_ONE, REFERRAL, THANK_YOU_SLIP. Auto-detected if omitted."
 *           example: "REFERRAL"
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
