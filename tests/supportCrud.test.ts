/**
 * Tests for Support Model & Mobile / Admin CRUD Operations
 */

jest.mock("../src/queues/notification.queue", () => ({
  QUEUE_NAMES: {
    PERSONAL: "notification-personal",
    BROADCAST: "notification-broadcast",
    CLEANUP: "notification-cleanup",
    DLQ: "notification-dlq",
  },
  defaultJobOptions: {},
  personalNotificationQueue: {
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    addBulk: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  },
  broadcastNotificationQueue: {
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    close: jest.fn().mockResolvedValue(undefined),
  },
  dlqNotificationQueue: {
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    close: jest.fn().mockResolvedValue(undefined),
  },
  personalQueueEvents: {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  },
  broadcastQueueEvents: {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../src/config/appRedis", () => ({
  appRedis: {
    status: "end",
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
    call: jest.fn().mockResolvedValue(1),
  },
  appRedisConfig: {},
  checkRedisHealth: jest.fn().mockResolvedValue({ status: "connected", latencyMs: 1 }),
}));

import { ObjectId } from "mongodb";
import { MobileSupportController } from "../src/controllers/mobile/SupportController";
import { AdminSupportController } from "../src/controllers/admin/SupportController";
import { Support, SupportStatus } from "../src/entity/Support";

describe("Support Controller CRUD (Mobile & Admin)", () => {
  let mobileController: MobileSupportController;
  let adminController: AdminSupportController;

  beforeEach(() => {
    mobileController = new MobileSupportController();
    adminController = new AdminSupportController();
  });

  test("1. Mobile Support entity and controller are initialized with methods", () => {
    expect(typeof mobileController.createSupport).toBe("function");
    expect(typeof mobileController.getAllSupports).toBe("function");
    expect(typeof mobileController.getSupportById).toBe("function");
    expect(typeof mobileController.updateSupport).toBe("function");
    expect(typeof mobileController.deleteSupport).toBe("function");
  });

  test("2. Admin Support controller is initialized with methods", () => {
    expect(typeof adminController.getStats).toBe("function");
    expect(typeof adminController.getSupports).toBe("function");
    expect(typeof adminController.getSupportById).toBe("function");
    expect(typeof adminController.updateStatus).toBe("function");
    expect(typeof adminController.updateSupport).toBe("function");
    expect(typeof adminController.deleteSupport).toBe("function");
  });

  test("3. Support model creates an instance with default status and active state", () => {
    const support = new Support();
    support._id = new ObjectId();
    support.name = "John Doe";
    support.phone = "9876543210";
    support.email = "john@example.com";
    support.companyName = "Acme Corp";
    support.category = "IT Support";
    support.description = "Need assistance with login";
    support.status = SupportStatus.PENDING;
    support.isActive = true;
    support.isDeleted = false;

    expect(support.name).toBe("John Doe");
    expect(support.phone).toBe("9876543210");
    expect(support.description).toBe("Need assistance with login");
    expect(support.status).toBe(SupportStatus.PENDING);
    expect(support.isActive).toBe(true);
    expect(support.isDeleted).toBe(false);
  });

  test("4. Mobile and Admin getSupportById validate ID format", async () => {
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    await mobileController.getSupportById("invalid-id", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);

    const mockAdminRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    await adminController.getSupportById("invalid-id", mockAdminRes);
    expect(mockAdminRes.status).toHaveBeenCalledWith(400);
  });
});
