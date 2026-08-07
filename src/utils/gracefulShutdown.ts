import { personalWorker } from "../workers/personal.worker";
import { broadcastWorker } from "../workers/broadcast.worker";
import { dlqWorker } from "../workers/dlq.worker";
import { personalNotificationQueue, broadcastNotificationQueue, dlqNotificationQueue } from "../queues/notification.queue";
import { redisConnection } from "../config/redis.config";

export async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n🛑 [Graceful Shutdown] ${signal} received. Closing workers and queues...`);

  try {
    // 1. Close BullMQ workers (waits for active jobs to finish)
    console.log("⏳ Pausing and closing workers...");
    await Promise.allSettled([
      personalWorker.close(),
      broadcastWorker.close(),
      dlqWorker.close(),
    ]);
    console.log("✅ All BullMQ workers closed cleanly.");

    // 2. Close BullMQ Queues
    console.log("⏳ Closing queues...");
    await Promise.allSettled([
      personalNotificationQueue.close(),
      broadcastNotificationQueue.close(),
      dlqNotificationQueue.close(),
    ]);
    console.log("✅ All BullMQ queues closed.");

    // 3. Disconnect Redis connection
    await redisConnection.quit();
    console.log("✅ Redis connection closed.");

  } catch (error: any) {
    console.error("❌ Error during graceful shutdown:", error.message);
  }
}

export function registerGracefulShutdown(): void {
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
}
