import cron from "node-cron";
import { DailyScoreService } from "./dailyScore.service";

export class DailyScoreCronService {
  /**
   * Initializes the daily score related cron jobs
   */
  static init() {
    console.log("⏰ Initializing Daily Score Cron Jobs...");

    // Cron job for 11:00 PM: "0 23 * * *"
    cron.schedule("0 23 * * *", async () => {
      try {
        console.log("🕒 Running Daily Score Reward Cron (11:00 PM)...");
        const dailyScoreService = new DailyScoreService();
        await dailyScoreService.runDailyScoreRewardCron();
      } catch (error: any) {
        console.error("❌ Daily Score Reward Cron Failed:", error.message);
      }
    });

    // Cron job for 11:59 PM: "59 23 * * *"
    cron.schedule("59 23 * * *", async () => {
      try {
        console.log("🕒 Running Daily Score Reset Cron (11:59 PM)...");
        const dailyScoreService = new DailyScoreService();
        await dailyScoreService.resetDailyScores();
      } catch (error: any) {
        console.error("❌ Daily Score Reset Cron Failed:", error.message);
      }
    });
  }
}
