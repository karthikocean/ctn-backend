import { ObjectId } from "mongodb";
import { validatePostResponseLimit } from "../src/services/moduleUsage.service";
import { SubscriptionService } from "../src/services/subscription.service";
import { AppDataSource } from "../src/data-source";
import { Message, MessageType } from "../src/entity/Message";
import { PostModel } from "../src/entity/Post";
import { Connection, ConnectionStatus } from "../src/entity/Connection";
import { BadRequestError } from "routing-controllers";

describe("User Plan-Based Post Response Limit Validation (New Members)", () => {
  const memberId = new ObjectId();
  const newMemberId = new ObjectId();
  const mutualMemberId = new ObjectId();
  const postId1 = new ObjectId();
  const postId2 = new ObjectId();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should succeed without error when postRespondCount is -1 (unlimited)", async () => {
    const mockPlan: any = {
      _id: new ObjectId(),
      title: "Unlimited Plan",
      benefits: { postRespondCount: -1 }
    };

    jest.spyOn(SubscriptionService.prototype, "getMemberPlan").mockResolvedValue(mockPlan);

    await expect(validatePostResponseLimit(memberId)).resolves.toBeUndefined();
  });

  it("should succeed without error when postRespondCount is not configured", async () => {
    const mockPlan: any = {
      _id: new ObjectId(),
      title: "Basic Plan",
      benefits: {}
    };

    jest.spyOn(SubscriptionService.prototype, "getMemberPlan").mockResolvedValue(mockPlan);

    await expect(validatePostResponseLimit(memberId)).resolves.toBeUndefined();
  });

  it("should throw error immediately when postRespondCount is 0", async () => {
    const mockPlan: any = {
      _id: new ObjectId(),
      title: "Restricted Plan",
      benefits: { postRespondCount: 0 }
    };

    jest.spyOn(SubscriptionService.prototype, "getMemberPlan").mockResolvedValue(mockPlan);

    await expect(validatePostResponseLimit(memberId)).rejects.toThrow(BadRequestError);
  });

  it("should allow response when non-mutual post responses are below limit", async () => {
    const mockPlan: any = {
      _id: new ObjectId(),
      title: "Standard Plan",
      benefits: { postRespondCount: 2 }
    };

    jest.spyOn(SubscriptionService.prototype, "getMemberPlan").mockResolvedValue(mockPlan);
    jest.spyOn(SubscriptionService.prototype, "getDateRangeByFrequency").mockReturnValue({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date()
    });

    const mockMessages: any[] = [
      {
        _id: new ObjectId(),
        senderId: memberId,
        postId: postId1,
        type: MessageType.POST_RESPONSE,
        createdAt: new Date()
      }
    ];

    const mockPosts: any[] = [
      { _id: postId1, memberId: newMemberId, isDeleted: false }
    ];

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Message) {
        return { find: jest.fn().mockResolvedValue(mockMessages) } as any;
      }
      if (entity === PostModel) {
        return { find: jest.fn().mockResolvedValue(mockPosts) } as any;
      }
      if (entity === Connection) {
        return { find: jest.fn().mockResolvedValue([]) } as any; // No mutual connection
      }
      return {} as any;
    });

    // 1 response < limit of 2 -> should succeed
    await expect(validatePostResponseLimit(memberId)).resolves.toBeUndefined();
  });

  it("should reject when non-mutual post responses reach the limit", async () => {
    const mockPlan: any = {
      _id: new ObjectId(),
      title: "Standard Plan",
      benefits: { postRespondCount: 1 }
    };

    jest.spyOn(SubscriptionService.prototype, "getMemberPlan").mockResolvedValue(mockPlan);
    jest.spyOn(SubscriptionService.prototype, "getDateRangeByFrequency").mockReturnValue({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date()
    });

    const mockMessages: any[] = [
      {
        _id: new ObjectId(),
        senderId: memberId,
        postId: postId1,
        type: MessageType.POST_RESPONSE,
        createdAt: new Date()
      }
    ];

    const mockPosts: any[] = [
      { _id: postId1, memberId: newMemberId, isDeleted: false }
    ];

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Message) {
        return { find: jest.fn().mockResolvedValue(mockMessages) } as any;
      }
      if (entity === PostModel) {
        return { find: jest.fn().mockResolvedValue(mockPosts) } as any;
      }
      if (entity === Connection) {
        return { find: jest.fn().mockResolvedValue([]) } as any; // Not mutual
      }
      return {} as any;
    });

    // 1 response >= limit of 1 -> should throw BadRequestError
    await expect(validatePostResponseLimit(memberId)).rejects.toThrow(BadRequestError);
  });

  it("should not count responses to mutual connections towards the new member limit", async () => {
    const mockPlan: any = {
      _id: new ObjectId(),
      title: "Standard Plan",
      benefits: { postRespondCount: 1 }
    };

    jest.spyOn(SubscriptionService.prototype, "getMemberPlan").mockResolvedValue(mockPlan);
    jest.spyOn(SubscriptionService.prototype, "getDateRangeByFrequency").mockReturnValue({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date()
    });

    const mockMessages: any[] = [
      {
        _id: new ObjectId(),
        senderId: memberId,
        postId: postId2,
        type: MessageType.POST_RESPONSE,
        createdAt: new Date()
      }
    ];

    const mockPosts: any[] = [
      { _id: postId2, memberId: mutualMemberId, isDeleted: false }
    ];

    // Mutual connection exists in both directions
    const mockConnections: any[] = [
      { senderId: memberId, receiverId: mutualMemberId, status: ConnectionStatus.ACCEPTED, isDeleted: false },
      { senderId: mutualMemberId, receiverId: memberId, status: ConnectionStatus.ACCEPTED, isDeleted: false }
    ];

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Message) {
        return { find: jest.fn().mockResolvedValue(mockMessages) } as any;
      }
      if (entity === PostModel) {
        return { find: jest.fn().mockResolvedValue(mockPosts) } as any;
      }
      if (entity === Connection) {
        return { find: jest.fn().mockResolvedValue(mockConnections) } as any;
      }
      return {} as any;
    });

    // Response was to a mutual connection, so non-mutual count is 0 < limit 1 -> succeeds
    await expect(validatePostResponseLimit(memberId)).resolves.toBeUndefined();
  });
});
