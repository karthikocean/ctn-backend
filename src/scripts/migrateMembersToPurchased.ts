import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { MemberSubscription } from "../entity/MemberSubscription";
import { Plan } from "../entity/Plan";
import { ObjectId } from "mongodb";

export async function migrateMembersToPurchased() {
  console.log("🚀 Starting Members to Purchased Plan Migration...");

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    console.log("✅ Database connected for migration.");
  }

  const memberRepo = AppDataSource.getMongoRepository(Member);
  const subRepo = AppDataSource.getMongoRepository(MemberSubscription);
  const planRepo = AppDataSource.getMongoRepository(Plan);

  // 1. Fetch available plans
  const plans = await planRepo.find({ where: { isDeleted: false, status: "active" } as any });
  if (plans.length === 0) {
    console.error("❌ No active plans found in the database. Please seed or create plans first.");
    return;
  }

  // Choose default plan (prefer "Advance" or "Basic" or the first active plan)
  const defaultPlan =
    plans.find((p) => p.title?.toLowerCase() === "advance") ||
    plans.find((p) => p.title?.toLowerCase() === "basic") ||
    plans[0];

  console.log(`📋 Default Plan selected for members without plan: ${defaultPlan.title} (${defaultPlan._id})`);

  // 2. Fetch all members that are not deleted
  const members = await memberRepo.find({
    where: { isDeleted: false } as any
  });

  console.log(`📊 Found ${members.length} member(s) to process.`);

  let updatedCount = 0;
  let alreadyPurchasedCount = 0;

  const now = new Date();

  for (const member of members) {
    try {
      // Determine which plan to assign
      let selectedPlan = defaultPlan;
      if (member.planId && ObjectId.isValid(member.planId)) {
        const existingPlan = plans.find((p) => p._id.toString() === member.planId?.toString());
        if (existingPlan) {
          selectedPlan = existingPlan;
        }
      }

      // Check current active subscription
      const currentActiveSub = await subRepo.findOne({
        where: {
          memberId: member._id,
          status: "ACTIVE",
          isDeleted: false
        } as any
      });

      // Calculate new subscription dates (1 Year validity)
      const startDate = now;
      const endDate = new Date(now);
      if (selectedPlan.billingCycle === "monthly") {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }

      // 1. Expire any existing active subscriptions (trial or old)
      await subRepo.updateMany(
        { memberId: member._id, status: "ACTIVE" } as any,
        { $set: { status: "EXPIRED", updatedAt: now } }
      );

      // 2. Create new Purchased MemberSubscription document
      const newSub = new MemberSubscription();
      newSub.memberId = member._id;
      newSub.planId = selectedPlan._id;
      newSub.type = selectedPlan.billingType || "basic";
      newSub.status = "ACTIVE";
      newSub.startDate = startDate;
      newSub.endDate = endDate;
      newSub.isTrial = false; // 👈 false indicates purchased
      newSub.isDeleted = false;
      newSub.createdAt = now;
      newSub.updatedAt = now;

      const savedSub = await subRepo.save(newSub);

      // 3. Update Member entity
      await memberRepo.updateOne(
        { _id: member._id },
        {
          $set: {
            subscriptionId: savedSub._id,
            planId: selectedPlan._id,
            subscriptionStartDate: startDate,
            subscriptionEndDate: endDate,
            hasUsedTrial: true,
            status: MemberStatus.ACTIVE,
            updatedAt: now
          }
        }
      );

      updatedCount++;
      console.log(
        `✅ Updated [${member.fullName || "Member"}] (${member.mobileNumber || member.email || member._id}) -> Plan: ${selectedPlan.title}, Validity: ${endDate.toISOString().split("T")[0]}`
      );
    } catch (err: any) {
      console.error(`❌ Error migrating member ${member._id}:`, err.message || err);
    }
  }

  console.log("──────────────────────────────────────────────────");
  console.log("🎉 Migration Complete:");
  console.log(`   - Total Members Processed : ${members.length}`);
  console.log(`   - Successfully Updated    : ${updatedCount}`);
  console.log("──────────────────────────────────────────────────");
}

// Allow direct CLI execution
if (require.main === module) {
  migrateMembersToPurchased()
    .then(() => {
      console.log("✨ Migration script finished.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Migration script error:", err);
      process.exit(1);
    });
}
