import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  Matches,
  Length,
  IsEnum
} from "class-validator";
import { EnquiryStatus } from "../../entity/Enquiry";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateEnquiryDto:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - phoneNumber
 *       properties:
 *         name:
 *           type: string
 *           example: "John Doe"
 *           description: "Full name of the person submitting the enquiry"
 *         email:
 *           type: string
 *           format: email
 *           example: "john.doe@example.com"
 *           description: "Contact email address"
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *           description: "10-digit phone number"
 *         enquiryType:
 *           type: string
 *           example: "General"
 *           description: "Type of enquiry selected from dropdown"
 *         city:
 *           type: string
 *           example: "Chennai"
 *           description: "City of the inquirer"
 *         companyName:
 *           type: string
 *           example: "Acme Corp"
 *           description: "Company name"
 *         comment:
 *           type: string
 *           example: "I would like to inquire about membership options."
 *           description: "Message or comment submitted with enquiry"
 */
export class CreateEnquiryDto {
  @IsString({ message: "Name must be a string" })
  @IsNotEmpty({ message: "Name is required" })
  @Length(2, 100, { message: "Name must be between 2 and 100 characters" })
    name!: string;

  @IsString({ message: "Email must be a string" })
  @IsNotEmpty({ message: "Email is required" })
  @IsEmail({}, { message: "Please provide a valid email address" })
    email!: string;

  @IsString({ message: "Phone number must be a string" })
  @IsNotEmpty({ message: "Phone number is required" })
  @Matches(/^[0-9]{10}$/, { message: "Phone number must be a valid 10-digit number" })
    phoneNumber!: string;

  @IsOptional()
  @IsString({ message: "Enquiry type must be a string" })
    enquiryType?: string;

  @IsOptional()
  @IsString({ message: "City must be a string" })
    city?: string;

  @IsOptional()
  @IsString({ message: "Company name must be a string" })
    companyName?: string;

  @IsOptional()
  @IsString({ message: "Comment must be a string" })
    comment?: string;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     UpdateEnquiryDto:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "John Doe"
 *         email:
 *           type: string
 *           format: email
 *           example: "john.doe@example.com"
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *         enquiryType:
 *           type: string
 *           example: "Membership"
 *         city:
 *           type: string
 *           example: "Bangalore"
 *         companyName:
 *           type: string
 *           example: "Acme Tech"
 *         comment:
 *           type: string
 *           example: "Updated message"
 *         status:
 *           type: string
 *           enum: [PENDING, IN_PROGRESS, RESOLVED, REJECTED]
 *           example: "IN_PROGRESS"
 *         adminNote:
 *           type: string
 *           example: "Followed up via phone call on 2026-08-13"
 */
export class UpdateEnquiryDto {
  @IsOptional()
  @IsString({ message: "Name must be a string" })
  @Length(2, 100, { message: "Name must be between 2 and 100 characters" })
    name?: string;

  @IsOptional()
  @IsString({ message: "Email must be a string" })
  @IsEmail({}, { message: "Please provide a valid email address" })
    email?: string;

  @IsOptional()
  @IsString({ message: "Phone number must be a string" })
  @Matches(/^[0-9]{10}$/, { message: "Phone number must be a valid 10-digit number" })
    phoneNumber?: string;

  @IsOptional()
  @IsString({ message: "Enquiry type must be a string" })
    enquiryType?: string;

  @IsOptional()
  @IsString({ message: "City must be a string" })
    city?: string;

  @IsOptional()
  @IsString({ message: "Company name must be a string" })
    companyName?: string;

  @IsOptional()
  @IsString({ message: "Comment must be a string" })
    comment?: string;

  @IsOptional()
  @IsEnum(EnquiryStatus, { message: "Invalid enquiry status. Must be one of PENDING, IN_PROGRESS, RESOLVED, REJECTED" })
    status?: EnquiryStatus;

  @IsOptional()
  @IsString({ message: "Admin note must be a string" })
    adminNote?: string;
}
