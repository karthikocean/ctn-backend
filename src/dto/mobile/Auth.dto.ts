import { IsString, IsNotEmpty, Length, IsEnum } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     MobileLoginDto:
 *       type: object
 *       required:
 *         - identifier
 *         - pin
 *       properties:
 *         identifier:
 *           type: string
 *           example: "9876543210"
 *         pin:
 *           type: string
 *           example: "1234"
 *     MobileSendOtpDto:
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
 *     MobileVerifyOtpLoginDto:
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

export class MobileLoginDto {
    @IsNotEmpty()
    @IsString()
      identifier!: string; // email or phone

    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      pin!: string;
}

export class MobileSendOtpDto {
    @IsNotEmpty()
    @IsString()
      identifier!: string;

    @IsEnum(["email", "phone"])
    @IsNotEmpty()
      type!: "email" | "phone";
}

export class MobileVerifyOtpLoginDto {
    @IsNotEmpty()
    @IsString()
      identifier!: string;

    @IsEnum(["email", "phone"])
    @IsNotEmpty()
      type!: "email" | "phone";

    @IsNotEmpty()
    @IsString()
    @Length(4, 4)
      otp!: string;
}

export class ResetPinDto {
    @IsNotEmpty()
    @IsString()
      identifier!: string;

    @IsEnum(["email", "phone"])
    @IsNotEmpty()
      type!: "email" | "phone";

    @IsNotEmpty()
    @IsString()
    @Length(4, 4)
      newPin!: string;
}
