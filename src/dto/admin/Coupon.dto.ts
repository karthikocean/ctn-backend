import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, Min } from "class-validator";
import { Type } from "class-transformer";
import { CouponStatus, DiscountType } from "../../entity/Coupon";

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty({ message: "Coupon code is required" })
    code!: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsEnum(DiscountType, { message: "Discount type must be 'percentage' or 'fixed'" })
  @IsNotEmpty({ message: "Discount type is required" })
    discountType!: DiscountType;

  @IsNumber()
  @Min(0, { message: "Discount value must be at least 0" })
    discountValue!: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
    minOrderAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
    maxDiscountAmount?: number;

  @Type(() => Date)
  @IsOptional()
    startDate?: Date;

  @Type(() => Date)
  @IsNotEmpty({ message: "End date is required" })
    endDate!: Date;

  @IsNumber()
  @IsOptional()
  @Min(1)
    usageLimit?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
    perUserLimit?: number = 1;

  @IsEnum(CouponStatus)
  @IsOptional()
    status?: CouponStatus = CouponStatus.ACTIVE;
}

export class UpdateCouponDto {
  @IsString()
  @IsOptional()
    code?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsEnum(DiscountType)
  @IsOptional()
    discountType?: DiscountType;

  @IsNumber()
  @IsOptional()
  @Min(0)
    discountValue?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
    minOrderAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
    maxDiscountAmount?: number;

  @Type(() => Date)
  @IsOptional()
    startDate?: Date;

  @Type(() => Date)
  @IsOptional()
    endDate?: Date;

  @IsNumber()
  @IsOptional()
  @Min(1)
    usageLimit?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
    perUserLimit?: number;

  @IsEnum(CouponStatus)
  @IsOptional()
    status?: CouponStatus;
}
