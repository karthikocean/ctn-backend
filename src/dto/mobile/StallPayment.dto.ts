import { IsNotEmpty, IsString } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     BuyStallDto:
 *       type: object
 *       required:
 *         - announcementId
 *         - stallId
 *       properties:
 *         announcementId:
 *           type: string
 *           description: ID of the event/stall announcement
 *         stallId:
 *           type: string
 *           description: ID of the stall item in announcement stallConfig
 *     VerifyStallPaymentDto:
 *       type: object
 *       required:
 *         - razorpayOrderId
 *         - razorpayPaymentId
 *         - razorpaySignature
 *       properties:
 *         razorpayOrderId:
 *           type: string
 *           description: The Razorpay order ID returned by the buy-stall checkout API
 *         razorpayPaymentId:
 *           type: string
 *           description: The Razorpay payment transaction ID
 *         razorpaySignature:
 *           type: string
 *           description: The HMAC-SHA256 signature returned by Razorpay for signature verification
 *     CancelStallPaymentDto:
 *       type: object
 *       required:
 *         - razorpayOrderId
 *       properties:
 *         razorpayOrderId:
 *           type: string
 *           description: The Razorpay order ID to cancel
 */

export class BuyStallDto {
  @IsString()
  @IsNotEmpty({ message: "Announcement ID is required" })
    announcementId!: string;

  @IsString()
  @IsNotEmpty({ message: "Stall ID is required" })
    stallId!: string;
}

export class VerifyStallPaymentDto {
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

export class CancelStallPaymentDto {
  @IsString()
  @IsNotEmpty({ message: "Razorpay Order ID is required" })
    razorpayOrderId!: string;
}
