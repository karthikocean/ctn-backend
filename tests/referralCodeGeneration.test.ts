/**
 * Tests for Bounded Referral Code Generation (P2-7)
 */

import { ReferralService } from "../src/services/referral.service";
import { AppDataSource } from "../src/data-source";
import { Member } from "../src/entity/Member";

describe("Bounded Referral Code Generation (P2-7)", () => {
  let referralService: ReferralService;
  let originalGetMongoRepository: any;

  beforeEach(() => {
    referralService = new ReferralService();
    originalGetMongoRepository = AppDataSource.getMongoRepository;
  });

  afterEach(() => {
    AppDataSource.getMongoRepository = originalGetMongoRepository;
  });

  test("1. Generates valid referral code with prefix when no collision occurs", async () => {
    const mockFindOne = jest.fn().mockResolvedValue(null);
    AppDataSource.getMongoRepository = jest.fn().mockReturnValue({
      findOne: mockFindOne
    });

    const code = await referralService.generateUniqueReferralCode("KARTHIK");
    expect(code).toBeDefined();
    expect(code.startsWith("KART")).toBe(true);
    expect(code.length).toBe(8);
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  test("2. Retries and successfully generates code when initial candidate collides", async () => {
    let callCount = 0;
    const mockFindOne = jest.fn().mockImplementation(() => {
      callCount++;
      // First 2 calls collide, 3rd call is unique
      return Promise.resolve(callCount <= 2 ? { _id: "existing_id" } : null);
    });

    AppDataSource.getMongoRepository = jest.fn().mockReturnValue({
      findOne: mockFindOne
    });

    const code = await referralService.generateUniqueReferralCode("ALEX");
    expect(code).toBeDefined();
    expect(code.startsWith("ALEX")).toBe(true);
    expect(mockFindOne).toHaveBeenCalledTimes(3);
  });

  test("3. Falls back to 8-character code when all prefix attempts collide", async () => {
    let callCount = 0;
    const mockFindOne = jest.fn().mockImplementation(() => {
      callCount++;
      // All 10 prefix attempts collide, but 1st fallback attempt is free
      return Promise.resolve(callCount <= 10 ? { _id: "existing_id" } : null);
    });

    AppDataSource.getMongoRepository = jest.fn().mockReturnValue({
      findOne: mockFindOne
    });

    const code = await referralService.generateUniqueReferralCode("TEST");
    expect(code).toBeDefined();
    expect(code.length).toBe(8);
    expect(mockFindOne).toHaveBeenCalledTimes(11);
  });

  test("4. Throws error when all bounded attempts collide rather than looping infinitely", async () => {
    // Every attempt collides
    const mockFindOne = jest.fn().mockResolvedValue({ _id: "existing_id" });

    AppDataSource.getMongoRepository = jest.fn().mockReturnValue({
      findOne: mockFindOne
    });

    await expect(
      referralService.generateUniqueReferralCode("BUSY", 5)
    ).rejects.toThrow("Unable to generate a unique referral code after maximum attempts");

    // Total attempts = 10 (prefix) + 5 (fallback) = 15
    expect(mockFindOne).toHaveBeenCalledTimes(15);
  });

  test("5. Fails immediately on database error without looping", async () => {
    const mockFindOne = jest.fn().mockRejectedValue(new Error("MongoNetworkError: connection lost"));

    AppDataSource.getMongoRepository = jest.fn().mockReturnValue({
      findOne: mockFindOne
    });

    await expect(
      referralService.generateUniqueReferralCode("JOHN")
    ).rejects.toThrow("MongoNetworkError: connection lost");

    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });
});
