import { IsString, IsNotEmpty, IsOptional, IsEmail } from "class-validator";

export class SendTestEmailDto {
  @IsEmail()
  @IsNotEmpty()
    email!: string;

  @IsString()
  @IsOptional()
    subject?: string;

  @IsString()
  @IsOptional()
    html?: string;
}
