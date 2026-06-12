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
  @IsNotEmpty({ message: "Payment method is required" })
    paymentMethod!: string;

  @IsNumber()
  @IsNotEmpty({ message: "Amount is required" })
    amount!: number;

  @IsString()
  @IsNotEmpty({ message: "Transaction ID is required" })
    transactionId!: string;

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
    paymentMethod?: string;

  @IsNumber()
  @IsOptional()
    amount?: number;

  @IsString()
  @IsOptional()
    transactionId?: string;

  @IsString()
  @IsOptional()
    remarks?: string;
}
