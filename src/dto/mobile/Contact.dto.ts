import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean
} from "class-validator";
import { ContactType } from "../../entity/Contact";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateContactDto:
 *       type: object
 *       required:
 *         - name
 *         - phoneNumber
 *         - type
 *       properties:
 *         name:
 *           type: string
 *           example: "John Doe"
 *         phoneNumber:
 *           type: string
 *           example: "+91 9876543210"
 *         type:
 *           type: string
 *           enum: [myself, referred]
 *           example: "myself"
 *         referredBy:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *     UpdateContactDto:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "John Doe"
 *         phoneNumber:
 *           type: string
 *           example: "+91 9876543210"
 *         type:
 *           type: string
 *           enum: [myself, referred]
 *           example: "referred"
 *         referredBy:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         isActive:
 *           type: boolean
 *           example: true
 */

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsEnum(ContactType)
  @IsOptional()
  type!: ContactType;

  @IsString()
  @IsOptional()
  referredBy?: string;
}

export class UpdateContactDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsEnum(ContactType)
  @IsOptional()
  type?: ContactType;

  @IsString()
  @IsOptional()
  referredBy?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
