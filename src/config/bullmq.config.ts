import { RedisOptions } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

let redisUrlOptions: Partial<RedisOptions> = {};
if (process.env.REDIS_URL) {
  try {
    const parsed = new URL(process.env.REDIS_URL);
    redisUrlOptions = {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? Number(parsed.port) : 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    };
  } catch {}
}

/**
 * Dedicated Redis configuration options for BullMQ queues, workers, and events.
 * BullMQ automatically creates dedicated blocking and non-blocking IORedis connections per instance.
 */
export const bullRedisConfig: RedisOptions & { skipVersionCheck?: boolean } = {
  host: process.env.REDIS_HOST || redisUrlOptions.host || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || redisUrlOptions.port || 6379,
  password: process.env.REDIS_PASSWORD || redisUrlOptions.password || undefined,
  db: Number(process.env.REDIS_DB) || redisUrlOptions.db || 0,
  maxRetriesPerRequest: null, // Mandatory for BullMQ workers
  enableReadyCheck: false,
  skipVersionCheck: true,
  retryStrategy(times: number) {
    // Silent exponential backoff for internal BullMQ connections (prevents log spam)
    return Math.min(times * 100, 3000);
  },
};
