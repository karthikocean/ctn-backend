import { IsNotEmpty, IsString, Length } from "class-validator";
/**
 * @swagger
 * components:
 *   schemas:
 *     SendOtpDto:
 *       type: object
 *       required:
 *         - identifier
 *         - type
 *       properties:
 *         identifier:
 *           type: string
 *           example: "user@example.com"
 *         type:
 *           type: string
 *           enum: [email, phone]
 *           example: "email"
 *     VerifyOtpDto:
 *       type: object
 *       required:
 *         - identifier
 *         - type
 *         - otp
 *       properties:
 *         identifier:
 *           type: string
 *           example: "user@example.com"
 *         type:
 *           type: string
 *           enum: [email, phone]
 *           example: "email"
 *         otp:
 *           type: string
 *           example: "1234"
 */

export class SendOtpDto {
  @IsString()
  @IsNotEmpty()
    identifier!: string; // Can be email or phone

  @IsString()
  @IsNotEmpty()
    type!: "email" | "phone";
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
    identifier!: string;

  @IsString()
  @IsNotEmpty()
    type!: "email" | "phone";

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
    otp!: string;
}
