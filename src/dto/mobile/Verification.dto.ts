import { IsNotEmpty, IsString, Length } from "class-validator";

export class SendOtpDto {
  @IsString()
  @IsNotEmpty()
    identifier!: string; // Can be email or phone

  @IsString()
  @IsNotEmpty()
    type!: "email" | "phone";
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
    identifier!: string;

  @IsString()
  @IsNotEmpty()
    type!: "email" | "phone";

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
    otp!: string;
}
