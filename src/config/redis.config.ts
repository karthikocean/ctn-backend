import Redis, { RedisOptions } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

export const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 3000);
    console.warn(`[Redis] Reconnecting attempt #${times} in ${delay}ms...`);
    return delay;
  },
};

// Shared IORedis connection instance for general operations
export const redisConnection = new Redis(redisConfig);

redisConnection.on("connect", () => {
  console.log("✅ [Redis] Connected successfully to Redis server");
});

redisConnection.on("error", (err: any) => {
  console.error("❌ [Redis] Connection error:", err.message);
});
