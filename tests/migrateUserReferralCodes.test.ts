import { ObjectId } from "mongodb";
import { migrateUserReferralCodes } from "../src/scripts/migrateUserReferralCodes";
import { AppDataSource } from "../src/data-source";

describe("User Referral Codes Migration Script", () => {
  let mockMemberRepo: any;

  beforeEach(() => {
    mockMemberRepo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true })
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockReturnValue(mockMemberRepo as any);
    Object.defineProperty(AppDataSource, "isInitialized", { value: true, configurable: true });
  });

  it("should find members without referralCode, generate codes and update them", async () => {
    const member1 = { _id: new ObjectId(), fullName: "John Doe" };
    const member2 = { _id: new ObjectId(), fullName: "Jane Smith" };

    mockMemberRepo.find.mockResolvedValueOnce([member1, member2]);
    mockMemberRepo.findOneBy
      .mockResolvedValueOnce(member1)
      .mockResolvedValueOnce(member2);

    await migrateUserReferralCodes();

    expect(mockMemberRepo.updateOne).toHaveBeenCalledTimes(2);
    expect(mockMemberRepo.updateOne).toHaveBeenCalledWith(
      { _id: member1._id },
      expect.objectContaining({ $set: expect.objectContaining({ referralCode: expect.any(String) }) })
    );
  });

  it("should be idempotent and skip members that already have a referral code", async () => {
    const memberWithCode = { _id: new ObjectId(), fullName: "Existing User", referralCode: "EXIST123" };

    mockMemberRepo.find.mockResolvedValueOnce([memberWithCode]);
    mockMemberRepo.findOneBy.mockResolvedValueOnce(memberWithCode); // Already has code

    await migrateUserReferralCodes();

    expect(mockMemberRepo.updateOne).not.toHaveBeenCalled();
  });
});
