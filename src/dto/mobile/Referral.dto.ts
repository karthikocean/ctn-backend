import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  Length
} from "class-validator";
import { Type } from "class-transformer";
import { UserReferralStatus } from "../../entity/UserReferral";

/**
 * @swagger
 * components:
 *   schemas:
 *     ApplyReferralDto:
 *       type: object
 *       required:
 *         - referralCode
 *       properties:
 *         referralCode:
 *           type: string
 *           example: "ANBU8F42"
 *           description: "Valid referral code of the referrer member"
 *     VerifyReferralCodeDto:
 *       type: object
 *       required:
 *         - referralCode
 *       properties:
 *         referralCode:
 *           type: string
 *           example: "ANBU8F42"
 *           description: "Referral code to verify"
 *         email:
 *           type: string
 *           example: "member@example.com"
 *           description: "Optional email of the user to check self-referral"
 *         mobileNumber:
 *           type: string
 *           example: "+919876543210"
 *           description: "Optional phone of the user to check self-referral"
 *     ReferralHistoryQueryDto:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *           example: 1
 *           default: 1
 *         limit:
 *           type: integer
 *           example: 20
 *           default: 20
 *         status:
 *           type: string
 *           enum: [PENDING, COMPLETED, CANCELLED]
 *           example: "COMPLETED"
 *         sort:
 *           type: string
 *           enum: [asc, desc]
 *           default: "desc"
 */

export class ApplyReferralDto {
  @IsString()
  @IsNotEmpty({ message: "Referral code is required" })
  @Length(3, 20, { message: "Referral code must be between 3 and 20 characters" })
    referralCode!: string;
}

export class VerifyReferralCodeDto {
  @IsString()
  @IsNotEmpty({ message: "Referral code is required" })
  @Length(3, 20, { message: "Referral code must be between 3 and 20 characters" })
    referralCode!: string;

  @IsOptional()
  @IsString()
    email?: string;

  @IsOptional()
  @IsString()
    mobileNumber?: string;
}

export class ReferralHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
    page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
    limit?: number = 20;

  @IsOptional()
  @IsEnum(UserReferralStatus)
    status?: UserReferralStatus;

  @IsOptional()
  @IsEnum(["asc", "desc"])
    sort?: "asc" | "desc" = "desc";
}
