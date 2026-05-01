/**
 * @swagger
 * components:
 *   schemas:
 *     CreateAdminUserDto:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - companyName
 *         - phoneNumber
 *         - pin
 *         - roleId
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *         companyName:
 *           type: string
 *         phoneNumber:
 *           type: string
 *         pin:
 *           type: string
 *         roleId:
 *           type: string
 *         isActive:
 *           type: number
 *     UpdateAdminUserDto:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *         companyName:
 *           type: string
 *         phoneNumber:
 *           type: string
 *         pin:
 *           type: string
 *         roleId:
 *           type: string
 *         isActive:
 *           type: number
 *     UpdateAdminUserStatusDto:
 *       type: object
 *       required:
 *         - isActive
 *       properties:
 *         isActive:
 *           type: number
 */
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  IsPhoneNumber
} from "class-validator";
import { Type } from "class-transformer";

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
    name!: string;

  @IsOptional()
    profileImage?: {
    fileName?: string;
    path?: string;
    originalName?: string;
  } = {
        fileName: "",
        path: "",
        originalName: ""
      };

  @IsEmail()
    email!: string;

  @IsPhoneNumber("IN")
  @IsNotEmpty()
    phoneNumber!: string;

  // @Length(4)
  // @IsString()
  // @IsNotEmpty()
  //   pin!: string;

  @IsMongoId()
    roleId!: string;

  @IsOptional()
  @Type(() => Number)
    isActive?: number;

}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
    name?: string;

  @IsOptional()
    profileImage?: {
    fileName?: string;
    path?: string;
    originalName?: string;
  } = {
        fileName: "",
        path: "",
        originalName: ""
      };

  @IsOptional()
  @IsEmail()
    email?: string;

  @IsOptional()
  @IsString()
    companyName?: string;

  @IsOptional()
  @IsString()
    phoneNumber?: string;

  @IsOptional()
    pin?: string;

  @IsOptional()
  @IsMongoId()
    roleId?: string;

  @IsOptional()
  @Type(() => Number)
    isActive?: number;
}

export class UpdateAdminUserStatusDto {
  @IsNotEmpty()
  @Type(() => Number)
    isActive!: number;
}

