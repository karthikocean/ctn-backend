import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  Length,
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

    @IsString()
      companyName!: string;

    @IsPhoneNumber("IN")
    @IsNotEmpty()
      phoneNumber!: string;

    @Length(4)
    @IsString()
      pin!: string;

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
