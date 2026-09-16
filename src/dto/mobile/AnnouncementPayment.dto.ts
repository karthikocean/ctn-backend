import { IsNotEmpty, IsOptional, IsString } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     BuyEventAnnouncementDto:
 *       type: object
 *       properties:
 *         announcementId:
 *           type: string
 *           description: ID of the event announcement to book (optional if passed in URL path)
 *     VerifyEventPaymentDto:
 *       type: object
 *       required:
 *         - razorpayOrderId
 *         - razorpayPaymentId
 *         - razorpaySignature
 *       properties:
 *         razorpayOrderId:
 *           type: string
 *           description: The Razorpay order ID returned by the checkout API
 *         razorpayPaymentId:
 *           type: string
 *           description: The Razorpay payment transaction ID
 *         razorpaySignature:
 *           type: string
 *           description: The HMAC-SHA256 signature returned by Razorpay for signature verification
 *     CancelEventPaymentDto:
 *       type: object
 *       required:
 *         - razorpayOrderId
 *       properties:
 *         razorpayOrderId:
 *           type: string
 *           description: The Razorpay order ID to cancel
 */

export class BuyEventAnnouncementDto {
  @IsString()
  @IsOptional()
    announcementId?: string;
}

export class VerifyEventPaymentDto {
  @IsString()
  @IsNotEmpty({ message: "Razorpay Order ID is required" })
    razorpayOrderId!: string;

  @IsString()
  @IsNotEmpty({ message: "Razorpay Payment ID is required" })
    razorpayPaymentId!: string;

  @IsString()
  @IsNotEmpty({ message: "Razorpay Signature is required" })
    razorpaySignature!: string;
}

export class CancelEventPaymentDto {
  @IsString()
  @IsNotEmpty({ message: "Razorpay Order ID is required" })
    razorpayOrderId!: string;
}
