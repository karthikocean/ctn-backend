import { IsString, IsNotEmpty } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     StartTrialDto:
 *       type: object
 *       properties:
 *         planId:
 *           type: string
 *           example: "6a197bdec221c6d8c66783d6"
 *           description: Optional Trial Plan ID. If not provided, the default Trial Plan will be used.
 *     UpgradeSubscriptionDto:
 *       type: object
 *       required:
 *         - planId
 *       properties:
 *         planId:
 *           type: string
 *           example: "6a197bdec221c6d8c66783d6"
 *           description: The ID of the subscription plan to upgrade to
 *     BuySubscriptionDto:
 *       type: object
 *       required:
 *         - planId
 *       properties:
 *         planId:
 *           type: string
 *           example: "6a197bdec221c6d8c66783d6"
 *           description: The ID of the subscription plan to buy
 *     VerifyRazorpayPaymentDto:
 *       type: object
 *       required:
 *         - razorpayOrderId
 *         - razorpayPaymentId
 *         - razorpaySignature
 *       properties:
 *         razorpayOrderId:
 *           type: string
 *           example: "order_A1B2C3D4"
 *           description: The Razorpay order ID returned by the checkout API
 *         razorpayPaymentId:
 *           type: string
 *           example: "pay_X1Y2Z3W4"
 *           description: The Razorpay payment transaction ID
 *         razorpaySignature:
 *           type: string
 *           example: "abcdef123456..."
 *           description: The HMAC-SHA256 signature returned by Razorpay for signature verification
 *     CancelRazorpayPaymentDto:
 *       type: object
 *       required:
 *         - razorpayOrderId
 *       properties:
 *         razorpayOrderId:
 *           type: string
 *           example: "order_A1B2C3D4"
 *           description: The Razorpay order ID to cancel
 */

export class StartTrialDto {
  @IsString()
  @IsNotEmpty({ message: "Plan ID is required to start a trial" })
    planId!: string;
}

export class UpgradeSubscriptionDto {
  @IsString()
  @IsNotEmpty({ message: "Plan ID is required" })
    planId!: string;
}

export class BuySubscriptionDto {
  @IsString()
  @IsNotEmpty({ message: "Plan ID is required" })
    planId!: string;
}

export class DowngradeSubscriptionDto {
  @IsString()
  @IsNotEmpty({ message: "Plan ID is required" })
    planId!: string;
}

export class VerifyRazorpayPaymentDto {
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

export class CancelRazorpayPaymentDto {
  @IsString()
  @IsNotEmpty({ message: "Razorpay Order ID is required" })
    razorpayOrderId!: string;
}
