import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { ReferralService } from "../services/referral.service";

export async function migrateUserReferralCodes() {
  console.log("🚀 Starting User Referral Codes Migration...");

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    console.log("✅ Database initialized for migration.");
  }

  const memberRepo = AppDataSource.getMongoRepository(Member);
  const referralService = new ReferralService();

  // Find all members who do not have a referralCode
  const membersWithoutCode = await memberRepo.find({
    where: {
      $or: [
        { referralCode: { $exists: false } },
        { referralCode: null },
        { referralCode: "" }
      ]
    } as any
  });

  console.log(`📊 Found ${membersWithoutCode.length} members without a referral code.`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const member of membersWithoutCode) {
    try {
      // Re-verify in case another process updated it
      const current = await memberRepo.findOneBy({ _id: member._id });
      if (current && current.referralCode) {
        skippedCount++;
        continue;
      }

      const uniqueCode = await referralService.generateUniqueReferralCode(member.fullName);
      await memberRepo.updateOne(
        { _id: member._id },
        { $set: { referralCode: uniqueCode } }
      );
      updatedCount++;
      console.log(`[Migrate] Generated code ${uniqueCode} for member: ${member.fullName} (${member._id})`);
    } catch (err: any) {
      console.error(`❌ Failed to update referral code for member ${member._id}:`, err.message);
    }
  }

  console.log("────────────────────────────────────────");
  console.log(`✅ Migration Complete:`);
  console.log(`   - Total Processed: ${membersWithoutCode.length}`);
  console.log(`   - Successfully Updated: ${updatedCount}`);
  console.log(`   - Skipped (already had code): ${skippedCount}`);
  console.log("────────────────────────────────────────");
}

// Allow direct CLI execution: ts-node src/scripts/migrateUserReferralCodes.ts
if (require.main === module) {
  migrateUserReferralCodes()
    .then(() => {
      console.log("✨ Migration script completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Migration failed with error:", err);
      process.exit(1);
    });
}
