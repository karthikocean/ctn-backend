import crypto from "crypto";
import { appRedis } from "../config/appRedis";
import { MemberStatus } from "../entity/Member";

/** Seconds the auth result is trusted without hitting the DB */
const AUTH_CACHE_TTL_SECONDS = 300; // 5 minutes

/** Redis key prefix — never contains the raw token */
const AUTH_KEY_PREFIX = "auth:v1:";

/**
 * What we cache — deliberately minimal.
 * We store enough to authenticate without a DB round-trip.
 * We do NOT store the raw token, PIN, FCM token, or any PII beyond what the middleware needs.
 */
export interface CachedAuthData {
  userId: string;       // member _id as hex string
  status: MemberStatus; // ACTIVE / INACTIVE / BLOCKED
  isDeleted: boolean;
  tokenRecordExists: boolean; // true = UserToken row existed in DB
}

/**
 * Derives a deterministic, fixed-length Redis key from the raw JWT.
 * SHA-256 is one-way: the original token cannot be recovered from the cache key.
 * This prevents token exposure in Redis memory dumps, logs, or MONITOR output.
 */
function cacheKey(rawToken: string): string {
  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return `${AUTH_KEY_PREFIX}${hash}`;
}

/**
 * Returns cached auth data for this token, or null on cache miss / Redis error.
 * A Redis failure is treated as a cache miss — authentication falls back to MongoDB.
 */
export async function getAuthCache(rawToken: string): Promise<CachedAuthData | null> {
  try {
    if (appRedis.status !== "ready") return null;
    const raw = await appRedis.get(cacheKey(rawToken));
    if (!raw) return null;
    return JSON.parse(raw) as CachedAuthData;
  } catch {
    // Redis error must never bypass authentication — treat as miss
    return null;
  }
}

/**
 * Stores a successful auth lookup result in Redis.
 * Called only after all DB validations pass.
 * A Redis failure here is silently ignored — the request continues normally.
 */
export async function setAuthCache(rawToken: string, data: CachedAuthData): Promise<void> {
  try {
    if (appRedis.status !== "ready") return;
    await appRedis.set(cacheKey(rawToken), JSON.stringify(data), "EX", AUTH_CACHE_TTL_SECONDS);
  } catch {
    // Non-fatal: worst case the next request re-fetches from DB
  }
}

/**
 * Removes the cached auth record for this specific token.
 * Must be called on: logout, delete-account, token rotation (token replacement).
 * A Redis failure here is logged but does NOT block the operation — the DB record
 * is already deleted, so the token will fail DB validation within 5 minutes.
 */
export async function invalidateAuthCache(rawToken: string): Promise<void> {
  try {
    if (appRedis.status !== "ready") return;
    await appRedis.del(cacheKey(rawToken));
  } catch (err: any) {
    // Log but do not throw — caller should not fail because of a cache error
    console.warn("[AuthCache] Failed to invalidate cache entry:", err?.message);
  }
}
