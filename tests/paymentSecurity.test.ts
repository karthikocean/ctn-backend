/**
 * Tests for Payment and Subscription Analytics security & ownership verification.
 */

import { ObjectId } from "mongodb";
import { MobileSubscriptionController } from "../src/controllers/mobile/SubscriptionController";
import { RazorpayVerificationService } from "../src/services/razorpay.service";
import { AppDataSource } from "../src/data-source";
import crypto from "crypto";

describe("Payment & Subscription Analytics Security", () => {
  let controller: MobileSubscriptionController;
  let mockRes: any;

  beforeEach(() => {
    controller = new MobileSubscriptionController();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false
    };
    jest.clearAllMocks();
  });

  test("1. cancelPayment blocks IDOR when user attempts to cancel another user payment", async () => {
    const userAId = new ObjectId();
    const userBId = new ObjectId();
    const orderId = "order_123456";

    const mockReq = {
      user: { userId: userAId.toString() }
    };

    const mockBody = {
      razorpayOrderId: orderId
    };

    const mockPaymentFindOne = jest.fn().mockResolvedValue({
      _id: new ObjectId(),
      transactionId: orderId,
      memberId: userBId, // Payment belongs to user B!
      status: "PENDING"
    });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Payment") {
        return { findOneBy: mockPaymentFindOne, save: jest.fn() } as any;
      }
      return {} as any;
    });

    await controller.cancelPayment(mockReq, mockBody, mockRes);

    // Response should be 403 Forbidden due to ownership check
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("not authorized")
      })
    );
  });

  test("2. verifyPayment blocks IDOR when user attempts to verify another user payment", async () => {
    const userAId = new ObjectId();
    const userBId = new ObjectId();
    const orderId = "order_123456";

    const mockReq = {
      user: { userId: userAId.toString() }
    };

    const mockBody = {
      razorpayOrderId: orderId,
      razorpayPaymentId: "pay_123456",
      razorpaySignature: "sig_abc"
    };

    const mockPaymentFindOne = jest.fn().mockResolvedValue({
      _id: new ObjectId(),
      transactionId: orderId,
      memberId: userBId, // Payment belongs to user B!
      status: "PENDING"
    });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Payment") {
        return { findOneBy: mockPaymentFindOne } as any;
      }
      return {} as any;
    });

    await controller.verifyPayment(mockReq, mockBody, mockRes);

    // Response should be 403 Forbidden due to ownership check
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("not authorized")
      })
    );
  });

  test("3. cancelPayment succeeds when owner cancels their own pending payment", async () => {
    const userAId = new ObjectId();
    const orderId = "order_123456";

    const mockReq = {
      user: { userId: userAId.toString() }
    };

    const mockBody = {
      razorpayOrderId: orderId
    };

    const mockPayment = {
      _id: new ObjectId(),
      transactionId: orderId,
      memberId: userAId, // Matches authenticated user!
      status: "PENDING"
    };

    const mockSave = jest.fn().mockResolvedValue(mockPayment);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Payment") {
        return { findOneBy: jest.fn().mockResolvedValue(mockPayment), save: mockSave } as any;
      }
      return {} as any;
    });

    await controller.cancelPayment(mockReq, mockBody, mockRes);

    expect(mockSave).toHaveBeenCalled();
    expect(mockPayment.status).toBe("FAILED");
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Payment transaction cancelled successfully"
      })
    );
  });

  test("4. verifyUpgradePayment does not log sensitive payment details to console.log", async () => {
    process.env.RAZORPAY_KEY_SECRET = "test_secret_123";
    const service = new RazorpayVerificationService();

    const orderId = "order_safe_1";
    const paymentId = "pay_safe_1";
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const memberId = new ObjectId();
    const planId = new ObjectId();

    const paymentRecord = {
      _id: new ObjectId(),
      transactionId: orderId,
      memberId,
      planId,
      status: "PENDING"
    };

    const planRecord = {
      _id: planId,
      title: "Gold Plan",
      amount: 5000,
      durationInMonths: 12,
      type: "PREMIUM"
    };

    const memberRecord = {
      _id: memberId,
      fullName: "Test Member",
      fcmToken: "token_123"
    };

    const subRecord = {
      _id: new ObjectId(),
      memberId,
      planId,
      status: "ACTIVE"
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Payment") {
        return { findOneBy: jest.fn().mockResolvedValue(paymentRecord), save: jest.fn(), update: jest.fn() } as any;
      }
      if (entity.name === "Plan") {
        return { findOneBy: jest.fn().mockResolvedValue(planRecord) } as any;
      }
      if (entity.name === "Member") {
        return { findOneBy: jest.fn().mockResolvedValue(memberRecord), update: jest.fn() } as any;
      }
      if (entity.name === "MemberSubscription") {
        return { findOne: jest.fn().mockResolvedValue(subRecord), findOneBy: jest.fn().mockResolvedValue(subRecord), updateMany: jest.fn(), save: jest.fn().mockResolvedValue(subRecord) } as any;
      }
      return { findOneBy: jest.fn().mockResolvedValue(null) } as any;
    });

    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await service.verifyUpgradePayment(orderId, paymentId, signature);

    expect(result.success).toBe(true);
    // Ensure no raw payment objects or card details were logged
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.objectContaining({ card: expect.anything() }));
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.objectContaining({ vpa: expect.anything() }));

    consoleLogSpy.mockRestore();
  });
});
