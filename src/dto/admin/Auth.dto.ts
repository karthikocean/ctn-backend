/**
 * @swagger
 * components:
 *   schemas:
 *     LoginDto:
 *       type: object
 *       required:
 *         - phoneNumber
 *         - pin
 *       properties:
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *         pin:
 *           type: string
 *           example: "1234"
 *     ChangePinDto:
 *       type: object
 *       required:
 *         - oldPin
 *         - newPin
 *       properties:
 *         oldPin:
 *           type: string
 *           example: "1234"
 *         newPin:
 *           type: string
 *           example: "5678"
 *     ForgotPinDto:
 *       type: object
 *       required:
 *         - phoneNumber
 *       properties:
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *     VerifyOtpDto:
 *       type: object
 *       required:
 *         - phoneNumber
 *         - otp
 *       properties:
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *         otp:
 *           type: string
 *           example: "1234"
 *     ResetPinDto:
 *       type: object
 *       required:
 *         - phoneNumber
 *         - newPin
 *       properties:
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *         newPin:
 *           type: string
 *           example: "1234"
 */
import { IsString, IsNotEmpty, IsPhoneNumber, Length } from "class-validator";

export class LoginDto {
    @IsPhoneNumber("IN")
    @IsNotEmpty()
      phoneNumber!: string;

    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      pin!: string;
}

export class ChangePinDto {
    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      oldPin!: string;

    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      newPin!: string;
}

export class ForgotPinDto {
    @IsPhoneNumber("IN")
    @IsNotEmpty()
      phoneNumber!: string;
}

export class VerifyOtpDto {
    @IsPhoneNumber("IN")
    @IsNotEmpty()
      phoneNumber!: string;

    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      otp!: string;
}

export class ResetPinDto {
    @IsPhoneNumber("IN")
    @IsNotEmpty()
      phoneNumber!: string;

    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      newPin!: string;
}

