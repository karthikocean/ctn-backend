
import rateLimit, { Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { appRedis } from "../config/appRedis";
import { rateLimitConfig } from "../config/rateLimit.config";
import { Request, Response } from "express";

/**
 * Test environment:
 * Do NOT initialize Redis-backed rate limiting.
 *
 * Jest will use express-rate-limit's default MemoryStore.
 *
 * Development/Production:
 * Use Redis-backed rate limiting.
 */
const isTestEnvironment = process.env.NODE_ENV === "test";

/**
 * Creates a Redis-backed store instance.
 *
 * Redis is intentionally disabled during tests to avoid:
 * - Redis connection attempts
 * - RedisStore initialization errors
 * - Lua script initialization
 * - unnecessary CI delays
 */
const getRedisStore = (prefixSuffix: string) => {
  if (isTestEnvironment) {
    return undefined;
  }

  return new RedisStore({
    // @ts-expect-error - ioredis sendCommand compatibility
    sendCommand: (...args: string[]) =>
      appRedis.call(args[0], ...args.slice(1)),
    prefix: `${rateLimitConfig.redisPrefix}${prefixSuffix}:`
  });
};

/**
 * Key generator helper:
 * Uses authenticated User ID if available,
 * falling back to IP.
 */
export const userOrIpKey = (req: Request): string => {
  const user = (req as any).user;
  const userId = user?.userId || user?.id || user?._id;

  if (userId) {
    return `user:${userId.toString()}`;
  }

  return req.ip || "127.0.0.1";
};

/**
 * Key generator helper for Auth/OTP:
 * Combines IP + target identifier (email/phone).
 */
export const identifierOrIpKey = (req: Request): string => {
  const body = req.body || {};

  const identifier =
    body.identifier ||
    body.phone ||
    body.mobileNumber ||
    body.email ||
    "";

  const cleanId = String(identifier).trim().toLowerCase();
  const ip = req.ip || "127.0.0.1";

  if (cleanId) {
    return `${ip}_${cleanId}`;
  }

  return ip;
};

/**
 * Factory function to build standardized rate limiters.
 *
 * Test:
 *   MemoryStore
 *
 * Development/Production:
 *   RedisStore
 */
const createLimiter = (
  key: string,
  windowMs: number,
  max: number,
  message: string,
  keyGenerator?: (req: Request) => string
) => {
  const redisStore = getRedisStore(key);

  const options: Partial<Options> = {
    windowMs,
    max,

    standardHeaders: true,
    legacyHeaders: false,

    /**
     * Fail-open:
     * Redis outages do not block the application.
     */
    passOnStoreError: true,

    keyGenerator:
      keyGenerator || ((req: Request) => req.ip || "127.0.0.1"),

    /**
     * Test environment:
     * redisStore === undefined
     * express-rate-limit automatically uses MemoryStore.
     *
     * Production/Development:
     * RedisStore is used when rate limiting is enabled.
     */
    ...(rateLimitConfig.enabled && redisStore
      ? {
        store: redisStore
      }
      : {}),

    skip: () => !rateLimitConfig.enabled,

    validate: {
      keyGeneratorIpFallback: false
    },

    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        message
      });
    }
  };

  return rateLimit(options);
};

// 1. General Public API Limiter
export const apiLimiter = createLimiter(
  "general",
  rateLimitConfig.general.windowMs,
  rateLimitConfig.general.max,
  "Too many requests. Please try again later."
);

// 2. Mobile Authenticated API Limiter
export const mobileApiLimiter = createLimiter(
  "mobile_api",
  rateLimitConfig.mobile.windowMs,
  rateLimitConfig.mobile.max,
  "Too many mobile API requests. Please slow down.",
  userOrIpKey
);

// 3. Admin Authenticated API Limiter
export const adminApiLimiter = createLimiter(
  "admin_api",
  rateLimitConfig.admin.windowMs,
  rateLimitConfig.admin.max,
  "Too many admin API requests. Please slow down.",
  userOrIpKey
);

// 4. Authentication (Login) Limiter
export const authLimiter = createLimiter(
  "auth",
  rateLimitConfig.auth.windowMs,
  rateLimitConfig.auth.max,
  "Too many login attempts. Please try again after 15 minutes.",
  identifierOrIpKey
);

// 5. OTP Limiter
export const otpLimiter = createLimiter(
  "otp",
  rateLimitConfig.otp.windowMs,
  rateLimitConfig.otp.max,
  "Too many OTP requests. Please wait a few minutes before trying again.",
  identifierOrIpKey
);

// 6. Password / PIN Reset Limiter
export const passwordResetLimiter = createLimiter(
  "password_reset",
  rateLimitConfig.passwordReset.windowMs,
  rateLimitConfig.passwordReset.max,
  "Too many PIN reset attempts. Please try again after 15 minutes.",
  identifierOrIpKey
);

// 7. File Upload & Import Limiter
export const uploadLimiter = createLimiter(
  "upload",
  rateLimitConfig.upload.windowMs,
  rateLimitConfig.upload.max,
  "Too many file upload requests. Please try again later.",
  userOrIpKey
);

// 8. Search & Filter Limiter
export const searchLimiter = createLimiter(
  "search",
  rateLimitConfig.search.windowMs,
  rateLimitConfig.search.max,
  "Too many search queries. Please slow down.",
  userOrIpKey
);

// 9. Payment & Subscription Operation Limiter
export const paymentLimiter = createLimiter(
  "payment",
  rateLimitConfig.payment.windowMs,
  rateLimitConfig.payment.max,
  "Too many payment operations. Please try again later.",
  userOrIpKey
);
