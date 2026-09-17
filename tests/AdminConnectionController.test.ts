import { ConnectionController } from "../src/controllers/admin/ConnectionController";
import { AppDataSource } from "../src/data-source";
import { ObjectId } from "mongodb";
import { ConnectionStatus } from "../src/entity/Connection";

describe("Admin ConnectionController - getEngagementSummary", () => {
  let controller: ConnectionController;
  let mockMemberRepo: any;
  let mockCategoryRepo: any;
  let mockConnectionRepo: any;
  let mockOneToOneRepo: any;
  let mockReferralRepo: any;
  let mockThankYouSlipRepo: any;
  let mockReportedHistoryRepo: any;

  const mockMemberId = new ObjectId("6a969fdd6f9832688a8a11ce");
  const otherMemberId = new ObjectId("6a969fdd6f9832688a8a11cf");
  const catId = new ObjectId("6a969fdd6f9832688a8a11cc");

  beforeEach(() => {
    mockMemberRepo = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            _id: mockMemberId,
            fullName: "Test Member",
            profilePhoto: "photo.jpg",
            businessName: "Acme Corp",
            businessCategory: catId,
            subCategory: null,
            mobileNumber: "9876543210",
            city: "Coimbatore"
          }
        ],
        1
      ])
    };

    mockCategoryRepo = {
      find: jest.fn().mockResolvedValue([
        {
          _id: catId,
          name: "Information Technology"
        }
      ])
    };

    mockConnectionRepo = {
      find: jest.fn().mockResolvedValue([
        {
          senderId: mockMemberId,
          receiverId: otherMemberId,
          status: ConnectionStatus.ACCEPTED
        },
        {
          senderId: otherMemberId,
          receiverId: mockMemberId,
          status: ConnectionStatus.REJECTED
        }
      ])
    };

    mockOneToOneRepo = {
      find: jest.fn().mockResolvedValue([
        {
          senderId: mockMemberId,
          receiverId: otherMemberId
        }
      ])
    };

    mockReferralRepo = {
      find: jest.fn().mockResolvedValue([
        {
          senderId: mockMemberId,
          receiverId: otherMemberId
        },
        {
          senderId: otherMemberId,
          receiverId: mockMemberId
        }
      ])
    };

    mockThankYouSlipRepo = {
      find: jest.fn().mockResolvedValue([
        {
          receiverId: mockMemberId,
          amount: 25000
        }
      ])
    };

    mockReportedHistoryRepo = {
      find: jest.fn().mockResolvedValue([
        {
          targetUserId: mockMemberId
        }
      ])
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const name = entity?.name || entity?.toString();
      if (name === "Member") return mockMemberRepo;
      if (name === "Category") return mockCategoryRepo;
      if (name === "Connection") return mockConnectionRepo;
      if (name === "OneToOne") return mockOneToOneRepo;
      if (name === "Referral") return mockReferralRepo;
      if (name === "ThankYouSlip") return mockThankYouSlipRepo;
      if (name === "ReportedHistory") return mockReportedHistoryRepo;
      return {} as any;
    });

    controller = new ConnectionController();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should calculate engagement summary metrics correctly with projected queries", async () => {
    const mockReq: any = { isFranchise: false };
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(data => data)
    };

    await controller.getEngagementSummary(
      mockReq,
      0, // page
      10, // limit
      "", // search
      "", // regionId
      mockRes
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const sendCall = mockRes.send.mock.calls[0][0];
    expect(sendCall.status).toBe(200);
    expect(sendCall.total).toBe(1);
    expect(sendCall.data).toHaveLength(1);

    const memberSummary = sendCall.data[0];
    expect(memberSummary._id).toBe(mockMemberId);
    expect(memberSummary.fullName).toBe("Test Member");
    expect(memberSummary.categoryName).toBe("Information Technology");
    expect(memberSummary.totalReqGivenCount).toBe(1);
    expect(memberSummary.sentAcceptedCount).toBe(1);
    expect(memberSummary.receivedRejectedCount).toBe(1);
    expect(memberSummary.directMeetCount).toBe(1);
    expect(memberSummary.giveRecommendationsCount).toBe(1);
    expect(memberSummary.recommendationReceivedCount).toBe(1);
    expect(memberSummary.receivedBusinessDoneCount).toBe(1);
    expect(memberSummary.receivedBusinessDoneAmount).toBe(25000);
    expect(memberSummary.reportedCount).toBe(1);

    // Verify memberRepo.findAndCount used select projections
    expect(mockMemberRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        select: [
          "_id",
          "fullName",
          "profilePhoto",
          "businessName",
          "businessCategory",
          "subCategory",
          "mobileNumber",
          "city"
        ]
      })
    );

    // Verify secondary lookups used select projections
    expect(mockConnectionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ["senderId", "receiverId", "status"]
      })
    );
    expect(mockOneToOneRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ["senderId", "receiverId"]
      })
    );
    expect(mockReferralRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ["senderId", "receiverId"]
      })
    );
    expect(mockThankYouSlipRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ["receiverId", "amount"]
      })
    );
    expect(mockReportedHistoryRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ["targetUserId"]
      })
    );
  });

  it("should return empty pagination early when no members match", async () => {
    mockMemberRepo.findAndCount.mockResolvedValue([[], 0]);

    const mockReq: any = { isFranchise: false };
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(data => data)
    };

    await controller.getEngagementSummary(
      mockReq,
      0,
      10,
      "nonexistent_member",
      "",
      mockRes
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const sendCall = mockRes.send.mock.calls[0][0];
    expect(sendCall.total).toBe(0);
    expect(sendCall.data).toEqual([]);

    // Secondary lookups must not be invoked
    expect(mockConnectionRepo.find).not.toHaveBeenCalled();
    expect(mockOneToOneRepo.find).not.toHaveBeenCalled();
    expect(mockReferralRepo.find).not.toHaveBeenCalled();
    expect(mockThankYouSlipRepo.find).not.toHaveBeenCalled();
  });
});
