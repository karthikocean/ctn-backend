import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  MaxLength
} from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateIncompleteRegistrationDto:
 *       type: object
 *       required:
 *         - fullName
 *         - mobileNumber
 *       properties:
 *         fullName:
 *           type: string
 *           example: "John Doe"
 *         mobileNumber:
 *           type: string
 *           example: "9876543210"
 *         email:
 *           type: string
 *           example: "john@example.com"
 *         step:
 *           type: string
 *           example: "basic_info"
 *           description: "Registration step at which the user dropped off"
 *         deviceInfo:
 *           type: string
 *           example: "iOS 17.0 / iPhone 15"
 *         fcmToken:
 *           type: string
 *           example: "fcm_token_here"
 */
export class CreateIncompleteRegistrationDto {
  @IsString()
  @IsNotEmpty({ message: "fullName is required" })
  @MaxLength(150)
    fullName!: string;

  @IsString()
  @IsNotEmpty({ message: "mobileNumber is required" })
  @MaxLength(20)
    mobileNumber!: string;

  @IsEmail({}, { message: "email must be a valid email address" })
  @IsOptional()
    email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
    step?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
    deviceInfo?: string;

  @IsString()
  @IsOptional()
    fcmToken?: string;
}
