import Redis, { RedisOptions } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

export const appRedisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
  maxRetriesPerRequest: 20,
  enableReadyCheck: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 3000);
    console.warn(`⚠️ [AppRedis] Reconnecting attempt #${times} in ${delay}ms...`);
    return delay;
  },
};

/**
 * Dedicated IORedis client instance for general application tasks
 * (caching, rate limiting, session, OTP operations).
 */
export const appRedis = new Redis(appRedisConfig);

appRedis.on("connect", () => {
  console.log("✅ [AppRedis] Connected successfully to Redis server");
});

appRedis.on("error", (err: Error) => {
  console.error("❌ [AppRedis] Connection error:", err.message);
});
