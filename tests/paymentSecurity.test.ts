/**
 * Tests for Payment and Subscription Analytics security & ownership verification.
 */

import { ObjectId } from "mongodb";
import { MobileSubscriptionController } from "../src/controllers/mobile/SubscriptionController";
import { AppDataSource } from "../src/data-source";

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
});
