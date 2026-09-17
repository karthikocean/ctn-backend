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
  },
  appRedisConfig: {},
  checkRedisHealth: jest.fn().mockResolvedValue({ status: "connected", latencyMs: 1 }),
}));

jest.mock("../src/utils/socket", () => ({
  getIO: jest.fn().mockReturnValue({
    to: jest.fn().mockReturnValue({
      emit: jest.fn()
    })
  }),
  isUserInConversation: jest.fn().mockReturnValue(false)
}));

import { ObjectId } from "mongodb";
import { ReminderService } from "../src/services/ReminderService";
import { Reminder, ReminderRecipientType, ReminderStatus, RepeatType, NotifyBy } from "../src/entity/Reminder";

describe("Reminder otherUser population and optimization", () => {
  let reminderService: ReminderService;
  let mockReminderRepo: any;
  let mockConvRepo: any;
  let mockMemberRepo: any;
  let mockCategoryRepo: any;

  const currentUserId = new ObjectId("650000000000000000000001");
  const otherUserId = new ObjectId("650000000000000000000002");
  const categoryId = new ObjectId("650000000000000000000003");

  const mockOtherMember = {
    _id: otherUserId,
    fullName: "Alice Smith",
    profilePhoto: "https://example.com/alice.jpg",
    businessName: "Alice Designs",
    businessCategory: categoryId,
    mobileNumber: "+919876543210",
    email: "alice@example.com",
    isOnline: true,
    lastSeen: new Date("2026-09-16T12:00:00Z"),
    status: "ACTIVE"
  };

  const mockCategory = {
    _id: categoryId,
    name: "Graphic Design"
  };

  beforeEach(() => {
    reminderService = new ReminderService();

    mockReminderRepo = {
      findAndCount: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn()
    };
    mockConvRepo = {
      find: jest.fn(),
      findOneBy: jest.fn()
    };
    mockMemberRepo = {
      find: jest.fn(),
      findOneBy: jest.fn()
    };
    mockCategoryRepo = {
      find: jest.fn()
    };

    (reminderService as any).reminderRepo = mockReminderRepo;
    (reminderService as any).conversationRepo = mockConvRepo;
    (reminderService as any).memberRepo = mockMemberRepo;
    (reminderService as any).categoryRepo = mockCategoryRepo;
  });

  it("should populate otherUser when current user is the creator and recipient is another user", async () => {
    const reminder: Partial<Reminder> = {
      _id: new ObjectId("650000000000000000000010"),
      title: "Follow up on proposal",
      createdBy: currentUserId,
      recipients: [otherUserId],
      recipientType: ReminderRecipientType.OTHER,
      status: ReminderStatus.PENDING,
      reminderDate: new Date()
    };

    mockReminderRepo.findAndCount.mockResolvedValue([[reminder], 1]);
    mockMemberRepo.find.mockResolvedValue([mockOtherMember]);
    mockCategoryRepo.find.mockResolvedValue([mockCategory]);

    const result = await reminderService.getReminderList({}, currentUserId.toString());

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    const item = result.data[0];
    expect(item.otherUser).toBeDefined();
    expect(item.otherUser._id.toString()).toBe(otherUserId.toString());
    expect(item.otherUser.fullName).toBe("Alice Smith");
    expect(item.otherUser.businessName).toBe("Alice Designs");
    expect(item.otherUser.categoryName).toBe("Graphic Design");
    expect(item.otherUser.isOnline).toBe(true);

    // Verify batching: 1 query to members, 1 to categories, 0 to conversations
    expect(mockMemberRepo.find).toHaveBeenCalledTimes(1);
    expect(mockCategoryRepo.find).toHaveBeenCalledTimes(1);
    expect(mockConvRepo.find).not.toHaveBeenCalled();
  });

  it("should populate otherUser when current user is the recipient and creator is another user", async () => {
    const reminder: Partial<Reminder> = {
      _id: new ObjectId("650000000000000000000011"),
      title: "Review contract",
      createdBy: otherUserId,
      recipients: [currentUserId],
      recipientType: ReminderRecipientType.OTHER,
      status: ReminderStatus.PENDING,
      reminderDate: new Date()
    };

    mockReminderRepo.findAndCount.mockResolvedValue([[reminder], 1]);
    mockMemberRepo.find.mockResolvedValue([mockOtherMember]);
    mockCategoryRepo.find.mockResolvedValue([mockCategory]);

    const result = await reminderService.getReminderList({}, currentUserId.toString());

    expect(result.total).toBe(1);
    expect(result.data[0].otherUser).toBeDefined();
    expect(result.data[0].otherUser.fullName).toBe("Alice Smith");
  });

  it("should resolve otherUser via conversationId for self-reminder in chat context", async () => {
    const convId = new ObjectId("650000000000000000000099");
    const reminder: Partial<Reminder> = {
      _id: new ObjectId("650000000000000000000012"),
      title: "Self reminder inside chat",
      createdBy: currentUserId,
      recipients: [currentUserId],
      conversationId: convId,
      recipientType: ReminderRecipientType.SELF,
      status: ReminderStatus.PENDING,
      reminderDate: new Date()
    };

    mockReminderRepo.findAndCount.mockResolvedValue([[reminder], 1]);
    mockConvRepo.find.mockResolvedValue([
      {
        _id: convId,
        participants: [currentUserId, otherUserId]
      }
    ]);
    mockMemberRepo.find.mockResolvedValue([mockOtherMember]);
    mockCategoryRepo.find.mockResolvedValue([mockCategory]);

    const result = await reminderService.getReminderList({}, currentUserId.toString());

    expect(result.total).toBe(1);
    expect(result.data[0].otherUser).toBeDefined();
    expect(result.data[0].otherUser.fullName).toBe("Alice Smith");
    expect(mockConvRepo.find).toHaveBeenCalledTimes(1);
  });

  it("should return otherUser as null for private self-reminder without chat context", async () => {
    const reminder: Partial<Reminder> = {
      _id: new ObjectId("650000000000000000000013"),
      title: "Private self note",
      createdBy: currentUserId,
      recipients: [currentUserId],
      recipientType: ReminderRecipientType.SELF,
      status: ReminderStatus.PENDING,
      reminderDate: new Date()
    };

    mockReminderRepo.findAndCount.mockResolvedValue([[reminder], 1]);

    const result = await reminderService.getReminderList({}, currentUserId.toString());

    expect(result.total).toBe(1);
    expect(result.data[0].otherUser).toBeNull();
    expect(mockMemberRepo.find).not.toHaveBeenCalled();
  });

  it("should populate otherUser in getReminder single fetch", async () => {
    const reminderId = new ObjectId("650000000000000000000014");
    const reminder: Partial<Reminder> = {
      _id: reminderId,
      title: "Single reminder test",
      createdBy: currentUserId,
      recipients: [otherUserId],
      recipientType: ReminderRecipientType.OTHER,
      isDeleted: false
    };

    mockReminderRepo.findOneBy.mockResolvedValue(reminder);
    mockMemberRepo.find.mockResolvedValue([mockOtherMember]);
    mockCategoryRepo.find.mockResolvedValue([mockCategory]);

    const result = await reminderService.getReminder(reminderId.toString(), currentUserId.toString());

    expect(result).toBeDefined();
    expect(result.otherUser).toBeDefined();
    expect(result.otherUser.fullName).toBe("Alice Smith");
    expect(result.otherUser.categoryName).toBe("Graphic Design");
  });
});
