jest.mock("../src/config/appRedis", () => ({
  appRedis: {
    status: "end",
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn()
  },
  redisConnection: {
    status: "end",
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn()
  }
}));

const mockOrdersCreate = jest.fn();
jest.mock("razorpay", () => {
  return jest.fn().mockImplementation(() => ({
    orders: {
      create: mockOrdersCreate
    }
  }));
});

jest.mock("../src/services/moduleUsage.service", () => ({
  validateModuleUsage: jest.fn().mockResolvedValue(true)
}));

jest.mock("../src/services/pushnotification.service", () => ({
  insertPushNotification: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../src/utils/id.generator", () => ({
  generateInvoiceNumber: jest.fn().mockResolvedValue("OSINV-TN10001")
}));

import crypto from "crypto";
import { ObjectId } from "mongodb";
import { AppDataSource } from "../src/data-source";
import { EventRazorpayService } from "../src/services/eventRazorpay.service";
import { MobileAnnouncementController } from "../src/controllers/mobile/AnnouncementController";
import { Announcement, AnnouncementStatus, AnnouncementType } from "../src/entity/Announcement";
import { Member, MemberStatus } from "../src/entity/Member";
import { AnnouncementBooking } from "../src/entity/AnnouncementBooking";
import { Payment } from "../src/entity/Payment";

describe("Event Booking Razorpay Payment Flow", () => {
  let service: EventRazorpayService;
  let controller: MobileAnnouncementController;
  let mockRes: any;
  let mockReq: any;

  let mockAnnouncementRepo: any;
  let mockMemberRepo: any;
  let mockEventBookingRepo: any;
  let mockPaymentRepo: any;

  const testMemberId = new ObjectId();
  const testAnnouncementId = new ObjectId();
  const testOrderId = "order_test_123456";
  const testPaymentId = "pay_test_987654";
  const testSecret = "test_razorpay_secret";

  beforeAll(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_key_id";
    process.env.RAZORPAY_KEY_SECRET = testSecret;
  });

  beforeEach(() => {
    service = new EventRazorpayService();
    controller = new MobileAnnouncementController();

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockReq = {
      user: { userId: testMemberId.toString() }
    };

    mockAnnouncementRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn()
    };

    mockMemberRepo = {
      findOneBy: jest.fn()
    };

    mockEventBookingRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((entity) => ({ _id: new ObjectId(), ...entity })),
      save: jest.fn().mockImplementation((b) => Promise.resolve({ ...b, _id: b._id || new ObjectId() }))
    };

    mockPaymentRepo = {
      findOneBy: jest.fn(),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ ...p, _id: p._id || new ObjectId() }))
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Announcement) return mockAnnouncementRepo;
      if (entity === Member) return mockMemberRepo;
      if (entity === AnnouncementBooking) return mockEventBookingRepo;
      if (entity === Payment) return mockPaymentRepo;
      return {} as any;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Initiate Event Buy (Razorpay Order Creation)", () => {
    it("should reject if announcement has no amount configured or amount is 0", async () => {
      mockMemberRepo.findOneBy.mockResolvedValue({
        _id: testMemberId,
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        announcementType: AnnouncementType.EVENT,
        status: AnnouncementStatus.PUBLISHED,
        amount: 0,
        isDeleted: false
      });

      await expect(
        service.initiateBuy(testMemberId.toString(), testAnnouncementId.toString())
      ).rejects.toThrow("This event does not require direct payment");
    });

    it("should reject if member has already booked this event", async () => {
      mockMemberRepo.findOneBy.mockResolvedValue({
        _id: testMemberId,
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        announcementType: AnnouncementType.EVENT,
        status: AnnouncementStatus.PUBLISHED,
        amount: 500,
        isDeleted: false
      });

      mockEventBookingRepo.findOne.mockResolvedValue({
        _id: new ObjectId(),
        status: "booked"
      });

      await expect(
        service.initiateBuy(testMemberId.toString(), testAnnouncementId.toString())
      ).rejects.toThrow("You have already booked this event");
    });

    it("should reject if event capacity is fully booked", async () => {
      mockMemberRepo.findOneBy.mockResolvedValue({
        _id: testMemberId,
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        announcementType: AnnouncementType.EVENT,
        status: AnnouncementStatus.PUBLISHED,
        amount: 500,
        membersLimit: 10,
        isDeleted: false
      });

      mockEventBookingRepo.findOne.mockResolvedValue(null);
      mockEventBookingRepo.count.mockResolvedValue(10);

      await expect(
        service.initiateBuy(testMemberId.toString(), testAnnouncementId.toString())
      ).rejects.toThrow("This event is fully booked");
    });

    it("should create razorpay order and pending payment successfully", async () => {
      mockMemberRepo.findOneBy.mockResolvedValue({
        _id: testMemberId,
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        title: "Annual Tech Summit",
        announcementType: AnnouncementType.EVENT,
        status: AnnouncementStatus.PUBLISHED,
        amount: 500,
        membersLimit: 50,
        isDeleted: false
      });

      mockEventBookingRepo.findOne.mockResolvedValue(null);
      mockEventBookingRepo.count.mockResolvedValue(5);

      mockOrdersCreate.mockResolvedValue({
        id: testOrderId,
        amount: 50000,
        currency: "INR"
      });

      const result = await service.initiateBuy(
        testMemberId.toString(),
        testAnnouncementId.toString()
      );

      expect(result.razorpayOrderId).toBe(testOrderId);
      expect(result.amount).toBe(50000);
      expect(result.currency).toBe("INR");
      expect(mockPaymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: testMemberId,
          announcementId: testAnnouncementId,
          amount: 500,
          status: "PENDING",
          action: "event_booking",
          transactionId: testOrderId
        })
      );
    });
  });

  describe("Verify Razorpay Payment Signature & Complete Booking", () => {
    it("should reject if signature is invalid", async () => {
      mockPaymentRepo.findOneBy.mockResolvedValue({
        _id: new ObjectId(),
        memberId: testMemberId,
        transactionId: testOrderId,
        status: "PENDING"
      });

      await expect(
        service.verifyPayment(
          testMemberId.toString(),
          testOrderId,
          testPaymentId,
          "invalid_signature"
        )
      ).rejects.toThrow("Invalid payment signature");
    });

    it("should reject if user is not authorized for this payment (IDOR check)", async () => {
      const validSignature = crypto
        .createHmac("sha256", testSecret)
        .update(`${testOrderId}|${testPaymentId}`)
        .digest("hex");

      mockPaymentRepo.findOneBy.mockResolvedValue({
        _id: new ObjectId(),
        memberId: new ObjectId(), // Different member!
        transactionId: testOrderId,
        status: "PENDING"
      });

      await expect(
        service.verifyPayment(
          testMemberId.toString(),
          testOrderId,
          testPaymentId,
          validSignature
        )
      ).rejects.toThrow("You are not authorized to verify this payment transaction");
    });

    it("should verify valid signature, mark payment completed, and create booking", async () => {
      const validSignature = crypto
        .createHmac("sha256", testSecret)
        .update(`${testOrderId}|${testPaymentId}`)
        .digest("hex");

      const mockPayment = {
        _id: new ObjectId(),
        memberId: testMemberId,
        announcementId: testAnnouncementId,
        amount: 500,
        transactionId: testOrderId,
        status: "PENDING"
      };

      mockPaymentRepo.findOneBy.mockResolvedValue(mockPayment);
      mockEventBookingRepo.findOne.mockResolvedValue(null);
      mockMemberRepo.findOneBy.mockResolvedValue({ _id: testMemberId, fcmToken: "mock-token" });
      mockAnnouncementRepo.findOneBy.mockResolvedValue({ _id: testAnnouncementId, title: "Tech Summit" });

      const result = await service.verifyPayment(
        testMemberId.toString(),
        testOrderId,
        testPaymentId,
        validSignature
      );

      expect(result.success).toBe(true);
      expect(result.data.amountPaid).toBe(500);
      expect(result.data.invoiceNumber).toBe("OSINV-TN10001");
      expect(mockPayment.status).toBe("COMPLETED");
      expect(mockEventBookingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          announcementId: testAnnouncementId,
          memberId: testMemberId,
          amountPaid: 500,
          paymentMethod: "razorpay",
          status: "booked"
        })
      );
    });
  });

  describe("Cancel Razorpay Payment", () => {
    it("should reject cancel if payment is already COMPLETED", async () => {
      mockPaymentRepo.findOneBy.mockResolvedValue({
        _id: new ObjectId(),
        memberId: testMemberId,
        transactionId: testOrderId,
        status: "COMPLETED"
      });

      await expect(
        service.cancelPayment(testMemberId.toString(), testOrderId)
      ).rejects.toThrow("Cannot cancel an already completed payment transaction");
    });

    it("should successfully cancel pending payment", async () => {
      const mockPayment = {
        _id: new ObjectId(),
        memberId: testMemberId,
        transactionId: testOrderId,
        status: "PENDING"
      };
      mockPaymentRepo.findOneBy.mockResolvedValue(mockPayment);

      const result = await service.cancelPayment(testMemberId.toString(), testOrderId);
      expect(result.success).toBe(true);
      expect(mockPayment.status).toBe("FAILED");
      expect(mockPaymentRepo.save).toHaveBeenCalled();
    });
  });

  describe("Controller Endpoints", () => {
    it("POST /buy should call initiateBuy and return 200", async () => {
      jest.spyOn((controller as any).eventRazorpayService, "initiateBuy").mockResolvedValue({
        razorpayOrderId: testOrderId,
        amount: 50000,
        currency: "INR",
        keyId: "rzp_test_key"
      });

      await controller.buyEventAnnouncementViaBody(mockReq, { announcementId: testAnnouncementId.toString() }, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ razorpayOrderId: testOrderId })
        })
      );
    });

    it("POST /verify-payment should verify and return 200", async () => {
      jest.spyOn((controller as any).eventRazorpayService, "verifyPayment").mockResolvedValue({
        success: true,
        message: "Event booked successfully via Razorpay",
        data: { bookingId: new ObjectId() }
      });

      await controller.verifyEventPayment(
        mockReq,
        {
          razorpayOrderId: testOrderId,
          razorpayPaymentId: testPaymentId,
          razorpaySignature: "sig"
        },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Event booked successfully via Razorpay"
        })
      );
    });
  });
});
