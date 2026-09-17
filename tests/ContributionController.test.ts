import { AdminContributionController } from "../src/controllers/admin/ContributionController";
import { AppDataSource } from "../src/data-source";
import { ObjectId } from "mongodb";

describe("AdminContributionController - getContributions", () => {
  let controller: AdminContributionController;
  let mockOneToOneRepo: any;
  let mockTySlipRepo: any;
  let mockReferralRepo: any;
  let mockMemberRepo: any;
  let mockAdminUserRepo: any;

  const mockSenderId = new ObjectId("6a969fdd6f9832688a8a11ce");
  const mockReceiverId = new ObjectId("6a969fdd6f9832688a8a11cf");

  beforeEach(() => {
    mockOneToOneRepo = {
      count: jest.fn().mockResolvedValue(2),
      find: jest.fn().mockResolvedValue([
        {
          _id: new ObjectId("6a1111111111111111111111"),
          senderId: mockSenderId,
          receiverId: mockReceiverId,
          createdAt: new Date("2026-09-10T10:00:00Z"),
          status: "COMPLETED"
        },
        {
          _id: new ObjectId("6a1111111111111111111112"),
          senderId: mockSenderId,
          receiverId: mockReceiverId,
          createdAt: new Date("2026-09-08T10:00:00Z"),
          status: "COMPLETED"
        }
      ])
    };

    mockTySlipRepo = {
      count: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue([
        {
          _id: new ObjectId("6a2222222222222222222221"),
          senderId: mockSenderId,
          receiverId: mockReceiverId,
          amount: 50000,
          businessDetails: "IT Consulting",
          createdAt: new Date("2026-09-12T10:00:00Z"),
          status: "RECEIVED"
        }
      ])
    };

    mockReferralRepo = {
      count: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue([
        {
          _id: new ObjectId("6a3333333333333333333331"),
          senderId: mockSenderId,
          receiverId: mockReceiverId,
          referralName: "Acme Corp",
          referralMobile: "9876543210",
          referralEmail: "acme@example.com",
          location: "Chennai",
          comments: "High priority lead",
          createdAt: new Date("2026-09-15T10:00:00Z"),
          status: "COMPLETED"
        }
      ])
    };

    mockMemberRepo = {
      find: jest.fn().mockResolvedValue([
        {
          _id: mockSenderId,
          fullName: "Sender User",
          profilePhoto: "sender.jpg",
          businessName: "Sender Business"
        },
        {
          _id: mockReceiverId,
          fullName: "Receiver User",
          profilePhoto: "receiver.jpg",
          businessName: "Receiver Business"
        }
      ])
    };

    mockAdminUserRepo = {
      find: jest.fn().mockResolvedValue([])
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const name = entity?.name || entity?.toString();
      if (name === "OneToOne") return mockOneToOneRepo;
      if (name === "ThankYouSlip") return mockTySlipRepo;
      if (name === "Referral") return mockReferralRepo;
      if (name === "Member") return mockMemberRepo;
      if (name === "AdminUser") return mockAdminUserRepo;
      return {} as any;
    });

    controller = new AdminContributionController();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should merge, sort DESC by date, and paginate unified contributions", async () => {
    const mockReq: any = { isFranchise: false };
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(data => data),
      json: jest.fn().mockImplementation(data => data)
    };

    await controller.getContributions(
      mockReq,
      0, // page
      10, // limit
      "", // search
      "all", // type
      "", // roleId
      "", // status
      "", // startDate
      "", // endDate
      mockRes
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const sendCall = mockRes.send.mock.calls[0][0];
    expect(sendCall.status).toBe(200);
    expect(sendCall.total).toBe(4); // 2 oto + 1 ty + 1 ref
    expect(sendCall.data).toHaveLength(4);

    // Verify DESC date ordering: Sep 15 (ref) -> Sep 12 (ty) -> Sep 10 (oto) -> Sep 8 (oto)
    const records = sendCall.data;
    expect(records[0].type).toBe("referral");
    expect(records[1].type).toBe("thank_you_slip");
    expect(records[2].type).toBe("one_to_one");
    expect(records[3].type).toBe("one_to_one");

    // Verify sender and receiver enrichment
    expect(records[0].sender.fullName).toBe("Sender User");
    expect(records[0].receiver.fullName).toBe("Receiver User");

    // Verify memberRepo.find used field projections
    expect(mockMemberRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ["_id", "fullName", "profilePhoto", "businessName"]
      })
    );
  });

  it("should filter by type=thank_you_slip and only query thank you slips", async () => {
    const mockReq: any = { isFranchise: false };
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(data => data),
      json: jest.fn().mockImplementation(data => data)
    };

    await controller.getContributions(
      mockReq,
      0,
      10,
      "",
      "thank_you_slip",
      "",
      "",
      "",
      "",
      mockRes
    );

    expect(mockOneToOneRepo.count).not.toHaveBeenCalled();
    expect(mockOneToOneRepo.find).not.toHaveBeenCalled();
    expect(mockReferralRepo.count).not.toHaveBeenCalled();
    expect(mockReferralRepo.find).not.toHaveBeenCalled();

    expect(mockTySlipRepo.count).toHaveBeenCalledTimes(1);
    expect(mockTySlipRepo.find).toHaveBeenCalledTimes(1);

    const sendCall = mockRes.send.mock.calls[0][0];
    expect(sendCall.total).toBe(1);
    expect(sendCall.data).toHaveLength(1);
    expect(sendCall.data[0].type).toBe("thank_you_slip");
    expect(sendCall.data[0].amount).toBe(50000);
  });

  it("should filter by status and only include referral when status is non-completed", async () => {
    const mockReq: any = { isFranchise: false };
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(data => data),
      json: jest.fn().mockImplementation(data => data)
    };

    await controller.getContributions(
      mockReq,
      0,
      10,
      "",
      "all",
      "",
      "PENDING",
      "",
      "",
      mockRes
    );

    // Non-completed status excludes one-to-one and thank you slips
    expect(mockOneToOneRepo.find).not.toHaveBeenCalled();
    expect(mockTySlipRepo.find).not.toHaveBeenCalled();
    expect(mockReferralRepo.find).toHaveBeenCalledTimes(1);

    const sendCall = mockRes.send.mock.calls[0][0];
    expect(sendCall.total).toBe(1);
    expect(sendCall.data[0].type).toBe("referral");
  });
});
