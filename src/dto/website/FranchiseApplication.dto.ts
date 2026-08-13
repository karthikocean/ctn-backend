import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  Matches,
  Length,
  IsEnum
} from "class-validator";
import { FranchiseApplicationStatus } from "../../entity/FranchiseApplication";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateFranchiseApplicationDto:
 *       type: object
 *       required:
 *         - fullName
 *         - phoneNumber
 *         - email
 *         - state
 *         - city
 *         - companyName
 *       properties:
 *         fullName:
 *           type: string
 *           example: "John Doe"
 *           description: "Applicant's full name"
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *           description: "10-digit phone number"
 *         email:
 *           type: string
 *           format: email
 *           example: "john.doe@example.com"
 *           description: "Contact email address"
 *         state:
 *           type: string
 *           example: "Tamil Nadu"
 *           description: "Selected State"
 *         city:
 *           type: string
 *           example: "Chennai"
 *           description: "Selected City"
 *         companyName:
 *           type: string
 *           example: "Apex Solutions Pvt Ltd"
 *           description: "Business or Company Name"
 */
export class CreateFranchiseApplicationDto {
  @IsString({ message: "Full name must be a string" })
  @IsNotEmpty({ message: "Full name is required" })
  @Length(2, 100, { message: "Full name must be between 2 and 100 characters" })
    fullName!: string;

  @IsString({ message: "Phone number must be a string" })
  @IsNotEmpty({ message: "Phone number is required" })
  @Matches(/^[0-9]{10}$/, { message: "Phone number must be a valid 10-digit number" })
    phoneNumber!: string;

  @IsString({ message: "Email must be a string" })
  @IsNotEmpty({ message: "Email is required" })
  @IsEmail({}, { message: "Please provide a valid email address" })
    email!: string;

  @IsString({ message: "State must be a string" })
  @IsNotEmpty({ message: "State is required" })
    state!: string;

  @IsString({ message: "City must be a string" })
  @IsNotEmpty({ message: "City is required" })
    city!: string;

  @IsString({ message: "Business / Company Name must be a string" })
  @IsNotEmpty({ message: "Business / Company Name is required" })
    companyName!: string;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     UpdateFranchiseApplicationDto:
 *       type: object
 *       properties:
 *         fullName:
 *           type: string
 *           example: "John Doe"
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *         email:
 *           type: string
 *           format: email
 *           example: "john.doe@example.com"
 *         state:
 *           type: string
 *           example: "Karnataka"
 *         city:
 *           type: string
 *           example: "Bangalore"
 *         companyName:
 *           type: string
 *           example: "Apex Solutions Pvt Ltd"
 *         status:
 *           type: string
 *           enum: [PENDING, UNDER_REVIEW, APPROVED, REJECTED]
 *           example: "UNDER_REVIEW"
 *         adminNote:
 *           type: string
 *           example: "Contacted applicant on 2026-08-13. Reviewing documents."
 */
export class UpdateFranchiseApplicationDto {
  @IsOptional()
  @IsString({ message: "Full name must be a string" })
  @Length(2, 100, { message: "Full name must be between 2 and 100 characters" })
    fullName?: string;

  @IsOptional()
  @IsString({ message: "Phone number must be a string" })
  @Matches(/^[0-9]{10}$/, { message: "Phone number must be a valid 10-digit number" })
    phoneNumber?: string;

  @IsOptional()
  @IsString({ message: "Email must be a string" })
  @IsEmail({}, { message: "Please provide a valid email address" })
    email?: string;

  @IsOptional()
  @IsString({ message: "State must be a string" })
    state?: string;

  @IsOptional()
  @IsString({ message: "City must be a string" })
    city?: string;

  @IsOptional()
  @IsString({ message: "Business / Company Name must be a string" })
    companyName?: string;

  @IsOptional()
  @IsEnum(FranchiseApplicationStatus, {
    message: "Invalid status. Must be one of PENDING, UNDER_REVIEW, APPROVED, REJECTED"
  })
    status?: FranchiseApplicationStatus;

  @IsOptional()
  @IsString({ message: "Admin note must be a string" })
    adminNote?: string;
}
