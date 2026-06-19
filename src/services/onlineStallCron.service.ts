import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { OnlineStallProduct } from "../entity/OnlineStallProduct";

export class OnlineStallCronService {
  private static productRepo = AppDataSource.getMongoRepository(OnlineStallProduct);

  /**
   * Initializes the Online Stall product expiration cron job
   */
  static init() {
    console.log("⏰ Initializing Online Stall Cron Jobs...");

    // Runs every day at 12:00 AM (midnight)
    cron.schedule("0 0 * * *", async () => {
      try {
        console.log("🕒 Running Online Stall Product Expiration Cron...");
        await this.expireProducts();
      } catch (error: any) {
        console.error("❌ Online Stall Product Expiration Cron Failed:", error.message);
      }
    });
  }

  /**
   * Soft deletes products that have reached or passed their end date
   */
  static async expireProducts() {
    const now = new Date();

    const result = await this.productRepo.updateMany(
      {
        endDate: { $lte: now },
        isDeleted: false
      },
      {
        $set: {
          isDeleted: true
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Expired Online Stall Products: ${result.modifiedCount} products set to deleted.`);
    }
  }
}
