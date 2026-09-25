import Redis, { RedisOptions } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const isTest = process.env.NODE_ENV === "test";

let redisUrlOptions: Partial<RedisOptions> = {};
if (process.env.REDIS_URL) {
  try {
    const parsed = new URL(process.env.REDIS_URL);
    redisUrlOptions = {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? Number(parsed.port) : 6379,
      password: parsed.password || undefined,
      db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    };
  } catch {}
}

export const appRedisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || redisUrlOptions.host || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || redisUrlOptions.port || 6379,
  password: process.env.REDIS_PASSWORD || redisUrlOptions.password || undefined,
  db: Number(process.env.REDIS_DB) || redisUrlOptions.db || 0,
  // In tests, do not retry commands to avoid hanging Jest runners.
  maxRetriesPerRequest: isTest ? 0 : 3,
  enableReadyCheck: !isTest,
  lazyConnect: isTest,
  retryStrategy(times: number) {
    if (isTest) return null;
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
  if (!isTest) {
    console.log("✅ [AppRedis] Connected successfully to Redis server");
  }
});

appRedis.on("error", (err: Error) => {
  // Tests should not emit asynchronous logs after Jest has completed.
  if (process.env.NODE_ENV !== "test") {
    console.error("❌ [AppRedis] Connection error:", err.message);
  }
});

/**
 * Asynchronously checks Redis connection health and latency with a 1-second timeout.
 * Returns operational status without leaking connection strings or credentials.
 */
export async function checkRedisHealth(): Promise<{
  status: "connected" | "disconnected" | "connecting";
  latencyMs?: number;
}> {
  try {
    const redisStatus = appRedis.status;
    if (redisStatus !== "ready" && redisStatus !== "connect") {
      const isConnecting = redisStatus === "connecting" || redisStatus === "reconnecting";
      return { status: isConnecting ? "connecting" : "disconnected" };
    }

    const start = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis ping timeout")), 1000);
      if (typeof timer.unref === "function") timer.unref();
    });

    const pingPromise = Promise.resolve(appRedis.ping());
    const pong = await Promise.race([pingPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (pong === "PONG") {
      return { status: "connected", latencyMs: Date.now() - start };
    }
    return { status: "disconnected" };
  } catch {
    return { status: "disconnected" };
  }
}
