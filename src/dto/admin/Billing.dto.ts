import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional
} from "class-validator";

export class CreateBillingDto {
  @IsString()
  @IsNotEmpty({ message: "Member ID is required" })
    memberId!: string;

  @IsString()
  @IsNotEmpty({ message: "Plan ID is required" })
    planId!: string;

  @IsString()
  @IsNotEmpty({ message: "Payment type is required" })
    paymentType!: string;

  @IsNumber()
  @IsNotEmpty({ message: "Amount is required" })
    amount!: number;

  @IsString()
  @IsOptional()
    remarks?: string;
}

export class UpdateBillingDto {
  @IsString()
  @IsOptional()
    memberId?: string;

  @IsString()
  @IsOptional()
    planId?: string;

  @IsString()
  @IsOptional()
    paymentType?: string;

  @IsNumber()
  @IsOptional()
    amount?: number;

  @IsString()
  @IsOptional()
    remarks?: string;
}
