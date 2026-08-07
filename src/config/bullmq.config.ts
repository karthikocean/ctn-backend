import { RedisOptions } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

/**
 * Dedicated Redis configuration options for BullMQ queues, workers, and events.
 * BullMQ automatically creates dedicated blocking and non-blocking IORedis connections per instance.
 */
export const bullRedisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
  maxRetriesPerRequest: null, // Mandatory for BullMQ workers
  enableReadyCheck: false,
  retryStrategy(times: number) {
    // Silent exponential backoff for internal BullMQ connections (prevents log spam)
    return Math.min(times * 100, 3000);
  },
};
