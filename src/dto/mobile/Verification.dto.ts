import { IsNotEmpty, IsString, Length, IsOptional, IsBoolean } from "class-validator";
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
 *         - otp
 *       properties:
 *         identifier:
 *           type: string
 *           example: "user@example.com"
 *         type:
 *           type: string
 *           enum: [email, phone]
 *           example: "email"
 *         phone:
 *           type: string
 *           example: "9876543210"
 *         email:
 *           type: string
 *           example: "user@example.com"
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
  @IsBoolean()
  @IsOptional()
  isRegister?: boolean;
}

export class VerifyOtpDto {
  @IsString()
  @IsOptional()
  identifier?: string;

  @IsString()
  @IsOptional()
  type?: "email" | "phone";

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
  otp!: string;
}

