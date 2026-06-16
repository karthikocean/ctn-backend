import { IsNotEmpty, IsString, Length, IsOptional } from "class-validator";
/**
 * @swagger
 * components:
 *   schemas:
 *     SendOtpDto:
 *       type: object
 *       properties:
 *         phone:
 *           type: string
 *           example: "9876543210"
 *         email:
 *           type: string
 *           example: "user@example.com"
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
  @IsOptional()
    phone?: string;

  @IsString()
  @IsOptional()
    email?: string;
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
