import { IsNotEmpty, IsString, IsNumber, Min, IsArray, IsOptional, IsEnum } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateOnlineStallProductDto:
 *       type: object
 *       required:
 *         - productName
 *         - price
 *         - location
 *         - marketplaceCategory
 *       properties:
 *         productName:
 *           type: string
 *           example: "Fresh Organic Apples"
 *         description:
 *           type: string
 *           example: "Sweet and crunchy organic apples."
 *         price:
 *           type: number
 *           example: 45
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           example: ["/images/apple1.jpg", "/images/apple2.jpg"]
 *         location:
 *           type: string
 *           enum: [region, Overall]
 *           example: "region"
 *         endDate:
 *           type: string
 *           example: "2026-07-20T00:00:00.000Z"
 *         marketplaceCategory:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3b"
 *     UpdateOnlineStallProductDto:
 *       type: object
 *       properties:
 *         productName:
 *           type: string
 *           example: "Fresh Organic Apples (Premium)"
 *         description:
 *           type: string
 *           example: "Premium selected sweet and crunchy organic apples."
 *         price:
 *           type: number
 *           example: 50
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           example: ["/images/apple_premium.jpg"]
 *         location:
 *           type: string
 *           enum: [region, Overall]
 *           example: "Overall"
 *         endDate:
 *           type: string
 *           example: "2026-07-20T00:00:00.000Z"
 *         marketplaceCategory:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3b"
 */

export class CreateOnlineStallProductDto {
  @IsString()
  @IsNotEmpty()
    productName!: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsNumber()
  @Min(0)
    price!: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    images?: string[];

  @IsEnum(["region", "Overall"])
  @IsNotEmpty()
    location!: "region" | "Overall";

  @IsString()
  @IsOptional()
    endDate?: string;

  @IsString()
  @IsNotEmpty()
    marketplaceCategory!: string;
}

export class UpdateOnlineStallProductDto {
  @IsString()
  @IsOptional()
    productName?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
    price?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
    images?: string[];

  @IsEnum(["region", "Overall"])
  @IsOptional()
    location?: "region" | "Overall";

  @IsString()
  @IsOptional()
    endDate?: string;

  @IsString()
  @IsOptional()
    marketplaceCategory?: string;
}
