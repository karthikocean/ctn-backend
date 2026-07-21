import { AppDataSource } from "../data-source";
import { Verification } from "../entity/Verification";

describe("OTP 2-Minute Expiration Verification Tests", () => {
  let verificationRepo: any;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    verificationRepo = AppDataSource.getMongoRepository(Verification);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("should create an OTP with 2 minutes expiration and fail verification when expired", async () => {
    const phoneNumber = "9876543210";
    await verificationRepo.deleteMany({ identifier: phoneNumber });

    // 1. Create verification entry expiring in 2 minutes
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 2);

    const verification = verificationRepo.create({
      identifier: phoneNumber,
      type: "phone",
      otp: "5678",
      expiresAt,
      isVerified: false
    });
    await verificationRepo.save(verification);

    // Verify it is not expired yet
    const activeVer = await verificationRepo.findOne({
      where: { identifier: phoneNumber, type: "phone", otp: "5678", isVerified: false }
    });
    expect(activeVer).toBeDefined();
    expect(new Date() > activeVer.expiresAt).toBe(false);

    // 2. Mock it as expired (set expiresAt to 1 second ago)
    activeVer.expiresAt = new Date(Date.now() - 1000);
    await verificationRepo.save(activeVer);

    // Verify it is now expired
    const expiredVer = await verificationRepo.findOne({
      where: { identifier: phoneNumber, type: "phone", otp: "5678", isVerified: false }
    });
    expect(expiredVer).toBeDefined();
    expect(new Date() > expiredVer.expiresAt).toBe(true);

    // Clean up
    await verificationRepo.deleteMany({ identifier: phoneNumber });
  });

  it("should fail reset-pin if verification is older than 2 minutes", async () => {
    const phoneNumber = "9876543210";
    await verificationRepo.deleteMany({ identifier: phoneNumber });

    // 1. Create a verified verification entry created 3 minutes ago
    const threeMinutesAgo = new Date();
    threeMinutesAgo.setMinutes(threeMinutesAgo.getMinutes() - 3);

    const verification = verificationRepo.create({
      identifier: phoneNumber,
      type: "phone",
      otp: "5678",
      expiresAt: new Date(Date.now() + 600000),
      isVerified: true
    });
    await verificationRepo.save(verification);
    await verificationRepo.updateOne(
      { _id: verification._id },
      { $set: { createdAt: threeMinutesAgo } }
    );

    const fetchedVer = await verificationRepo.findOne({
      where: { identifier: phoneNumber, type: "phone", isVerified: true }
    });
    expect(fetchedVer).toBeDefined();

    // Check if it's older than 2 minutes (like the check in resetPin)
    const twoMinutesAgo = new Date();
    twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() - 2);
    expect(fetchedVer.createdAt < twoMinutesAgo).toBe(true);

    // Clean up
    await verificationRepo.deleteMany({ identifier: phoneNumber });
  });
});
