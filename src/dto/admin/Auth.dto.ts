/**
 * @swagger
 * components:
 *   schemas:
 *     LoginDto:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           example: "admin@trustednetwork.in"
 *         password:
 *           type: string
 *           example: "Admin@1234"
 *     ChangePinDto:
 *       type: object
 *       required:
 *         - oldPin
 *         - newPin
 *       properties:
 *         oldPin:
 *           type: string
 *           example: "Admin@1234"
 *         newPin:
 *           type: string
 *           example: "Admin@5678"
 *     ForgotPinDto:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           example: "admin@trustednetwork.in"
 *     VerifyOtpDto:
 *       type: object
 *       required:
 *         - email
 *         - otp
 *       properties:
 *         email:
 *           type: string
 *           example: "admin@trustednetwork.in"
 *         otp:
 *           type: string
 *           example: "1234"
 *     ResetPinDto:
 *       type: object
 *       required:
 *         - email
 *         - newPassword
 *       properties:
 *         email:
 *           type: string
 *           example: "admin@trustednetwork.in"
 *         newPassword:
 *           type: string
 *           example: "Admin@5678"
 */
import { IsString, IsNotEmpty, IsEmail, Matches, Length } from "class-validator";

export const PASSWORD_POLICY_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\;/]).{8,}$/;

export class LoginDto {
  @IsEmail({}, { message: "Please enter a valid email address (e.g. admin@trustednetwork.in)" })
  @IsNotEmpty({ message: "Email address is required" })
  email!: string;

  @IsString({ message: "Password must be a string" })
  @IsNotEmpty({ message: "Password is required" })
  password!: string;
}

export class ChangePinDto {
  @IsString()
  @IsNotEmpty({ message: "Current password is required" })
  oldPin!: string;

  @Matches(PASSWORD_POLICY_REGEX, {
    message: "New password must be at least 8 characters long and contain at least one uppercase letter, one number, and one special character"
  })
  @IsNotEmpty({ message: "New password is required" })
  newPin!: string;
}

export class ForgotPinDto {
  @IsEmail({}, { message: "Please enter a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;
}

export class VerifyOtpDto {
  @IsEmail({}, { message: "Please enter a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @Length(4, 4, { message: "OTP must be exactly 4 digits" })
  @IsString()
  @IsNotEmpty({ message: "OTP is required" })
  otp!: string;
}

export class ResetPinDto {
  @IsEmail({}, { message: "Please enter a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @Matches(PASSWORD_POLICY_REGEX, {
    message: "Password must be at least 8 characters long and contain at least one uppercase letter, one number, and one special character"
  })
  @IsNotEmpty({ message: "New password is required" })
  newPassword!: string;
}
