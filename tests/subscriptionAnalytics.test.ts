/**
 * Tests for Subscription Analytics and Batching in SubscriptionCronService.
 */

import { ObjectId } from "mongodb";
import { SubscriptionCronService } from "../src/services/subscriptionCron.service";
import { AppDataSource } from "../src/data-source";

describe("Subscription Analytics & Batching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("1. runDailySubscriptionJob executes batch operations without N+1 per-record queries", async () => {
    const subId1 = new ObjectId();
    const subId2 = new ObjectId();
    const memberId1 = new ObjectId();
    const memberId2 = new ObjectId();

    const expiredSubs = [
      { _id: subId1, memberId: memberId1, status: "ACTIVE", type: "PREMIUM" },
      { _id: subId2, memberId: memberId2, status: "ACTIVE", type: "BUSINESS" }
    ];

    let subFindCallCount = 0;
    const mockSubFind = jest.fn().mockImplementation(() => {
      subFindCallCount++;
      // Only return subs for the first expired section to test clean phase execution
      if (subFindCallCount === 1) return Promise.resolve(expiredSubs);
      return Promise.resolve([]);
    });

    const mockSubUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    const mockMemberFind = jest.fn().mockResolvedValue([
      { _id: memberId1, fullName: "Member One", email: "one@test.com" },
      { _id: memberId2, fullName: "Member Two", email: "two@test.com" }
    ]);
    const mockMemberUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "MemberSubscription") {
        return {
          find: mockSubFind,
          updateMany: mockSubUpdateMany
        } as any;
      }
      if (entity.name === "Member") {
        return {
          find: mockMemberFind,
          updateMany: mockMemberUpdateMany
        } as any;
      }
      return {} as any;
    });

    await SubscriptionCronService.runDailySubscriptionJob();

    // Verify batch find on subscriptions
    expect(mockSubFind).toHaveBeenCalled();
    // Verify bulk update on MemberSubscription
    expect(mockSubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: [subId1, subId2] } }),
      expect.objectContaining({ $set: { status: "EXPIRED" } })
    );
    // Verify bulk update on Member
    expect(mockMemberUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: [memberId1, memberId2] } }),
      expect.objectContaining({ $set: { subscriptionId: null, planId: null } })
    );
    // Verify single batch member lookup (O(1) batch query instead of O(N) sequential queries)
    expect(mockMemberFind).toHaveBeenCalledTimes(1);
  });
});
