import { appRedis } from "../../../config/appRedis";
import { logger } from "../../../utils/logger";

interface MemoryLimitEntry {
  count: number;
  resetAt: number;
}

export class LeadGenerationLimitService {
  private static memoryStore = new Map<string, MemoryLimitEntry>();

  private static getLimit(): number {
    return Number(process.env.LEAD_GENERATION_HOURLY_LIMIT) || 10;
  }

  private static getWindowSec(): number {
    return Number(process.env.LEAD_GENERATION_WINDOW_SECONDS) || 3600; // 1 hour
  }

  /**
   * Check if user is within rate limit and increment count.
   */
  static async checkAndIncrement(
    userId: string
  ): Promise<{ allowed: boolean; remaining: number; resetTime: Date }> {
    const limit = this.getLimit();
    const windowSec = this.getWindowSec();
    const key = `ratelimit:leadgen:${userId}`;

    // Test environment or Redis disconnected fallback to memory store
    if (process.env.NODE_ENV === "test" || appRedis.status !== "ready") {
      const now = Date.now();
      const entry = this.memoryStore.get(userId);

      if (!entry || now > entry.resetAt) {
        const resetAt = now + windowSec * 1000;
        this.memoryStore.set(userId, { count: 1, resetAt });
        return {
          allowed: true,
          remaining: limit - 1,
          resetTime: new Date(resetAt)
        };
      }

      if (entry.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: new Date(entry.resetAt)
        };
      }

      entry.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, limit - entry.count),
        resetTime: new Date(entry.resetAt)
      };
    }

    try {
      const multi = appRedis.multi();
      multi.incr(key);
      multi.ttl(key);
      const results = await multi.exec();

      if (!results || results.length < 2) {
        return { allowed: true, remaining: limit - 1, resetTime: new Date(Date.now() + windowSec * 1000) };
      }

      const count = Number(results[0][1]);
      let ttl = Number(results[1][1]);

      if (count === 1 || ttl === -1) {
        await appRedis.expire(key, windowSec);
        ttl = windowSec;
      }

      const resetTime = new Date(Date.now() + Math.max(0, ttl) * 1000);
      const allowed = count <= limit;
      const remaining = Math.max(0, limit - count);

      return { allowed, remaining, resetTime };
    } catch (err: any) {
      logger.error(`Redis rate limit error for user ${userId}: ${err.message}`);
      // Fail open if Redis has transient error
      return { allowed: true, remaining: 1, resetTime: new Date(Date.now() + windowSec * 1000) };
    }
  }

  /**
   * Reset rate limit for a user (useful for testing or admin override)
   */
  static async reset(userId: string): Promise<void> {
    this.memoryStore.delete(userId);
    if (process.env.NODE_ENV !== "test" && appRedis.status === "ready") {
      try {
        await appRedis.del(`ratelimit:leadgen:${userId}`);
      } catch (err: any) {
        logger.error(`Failed to reset Redis rate limit for user ${userId}: ${err.message}`);
      }
    }
  }
}
