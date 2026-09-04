import {
  ExpressMiddlewareInterface,
  UnauthorizedError,
} from "routing-controllers";
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { ObjectId } from "mongodb";
import { UserToken } from "../entity/UserToken";
import { handleErrorResponse } from "../utils";
import {
  getAuthCache,
  setAuthCache,
  invalidateAuthCache,
  CachedAuthData
} from "../services/authCache.service";
import logger from "../utils/logger";

const CTX = "MobileAuthMiddleware";

export class MobileAuthMiddleware implements ExpressMiddlewareInterface {
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const t0 = Date.now();
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new UnauthorizedError("Authorization header missing");
      }

      if (!authHeader.startsWith("Bearer ")) {
        throw new UnauthorizedError("Invalid authorization format");
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        throw new UnauthorizedError("Token missing");
      }

      // ── 1. Verify / decode JWT structure (local CPU, no DB) ────────────────
      let decoded: JwtPayload;
      let isExpired = false;

      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
      } catch (error: any) {
        if (error.name === "TokenExpiredError") {
          isExpired = true;
          try {
            decoded = jwt.verify(token, process.env.JWT_SECRET as string, { ignoreExpiration: true }) as JwtPayload;
          } catch {
            throw new UnauthorizedError("Invalid token");
          }
        } else {
          throw new UnauthorizedError("Invalid token");
        }
      }

      const decodedId = decoded.userId || decoded.id;
      if (!decoded || typeof decoded !== "object" || !decodedId || !ObjectId.isValid(decodedId)) {
        logger.error("Mobile Auth Error: Missing or invalid ID in payload", undefined, CTX);
        throw new UnauthorizedError("Invalid token payload");
      }

      // ── 2. Redis cache lookup (skip DB on cache hit) ──────────────────────
      //
      // We only serve from cache when the token is NOT expired.
      // An expired token always hits MongoDB so we can rotate it in the DB record
      // and issue a new x-new-token header — this cannot be skipped.
      //
      // Security properties preserved by the cache:
      //  • Logout: invalidateAuthCache() is called synchronously in logout().
      //  • Delete account: invalidateAuthCache() called in deleteProfile().
      //  • Token rotation: invalidateAuthCache() called before saving new token.
      //  • Suspended accounts: cache stores member.status; a status change will
      //    be reflected within the 5-min TTL. For immediate lockout, call
      //    invalidateAuthCache() from the admin suspend endpoint.
      //  • Redis unavailable: getAuthCache() returns null → full DB path.
      //  • Cache poisoning: key is SHA-256(token) — cannot be guessed/crafted.
      if (!isExpired) {
        const tRedis = Date.now();
        const cached = await getAuthCache(token);
        const redisMs = Date.now() - tRedis;

        if (cached) {
          logger.debug(`Auth cache HIT (${redisMs}ms, total ${Date.now() - t0}ms)`, CTX, { userId: cached.userId });

          // Validate the cached data exactly as we would the DB result
          if (!cached.tokenRecordExists) {
            // Token was invalidated (logout happened between requests)
            // The cache entry should have been deleted on logout, but handle
            // the edge case defensively.
            _res.status(405).json({
              success: false,
              message: "Session expired. Please login again."
            });
            return;
          }

          if (cached.isDeleted || cached.status !== MemberStatus.ACTIVE) {
            if (cached.isDeleted) {
              throw new UnauthorizedError("Member not found or account deleted");
            }
            throw new UnauthorizedError(`Account is ${cached.status}. Please contact support.`);
          }

          (req as any).user = {
            ...decoded,
            userId: decodedId,
            id: decodedId,
            userType: "MEMBER"
          };
          next();
          return;
        }

        logger.debug(`Auth cache MISS (${redisMs}ms) — falling through to DB`, CTX, { userId: decodedId });
      }

      // ── 3. DB path: verify session token + member in one logical block ─────
      //
      // FIX: Original code fetched Member TWICE:
      //   • Once at line 66 (error path when no token record found — to decide 405 vs 401)
      //   • Once at line 84 (happy path — to check status)
      //
      // These are on mutually exclusive code paths, so there was never a literal
      // double-fetch on a single request. However the happy-path still cost
      // 2 serial DB round-trips (UserToken + Member). We now run them concurrently
      // with Promise.all, then reuse the Member result on both paths.
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const memberRepo = AppDataSource.getMongoRepository(Member);

      const tDb = Date.now();
      const [activeTokenRecord, member] = await Promise.all([
        tokenRepo.findOneBy({
          userId: new ObjectId(decodedId),
          token: token
        }),
        memberRepo.findOneBy({
          _id: new ObjectId(decodedId),
          isDeleted: false
        })
      ]);
      const dbMs = Date.now() - tDb;
      logger.debug(`Auth DB queries (concurrent): ${dbMs}ms`, CTX, { userId: decodedId });

      // ── 3a. Token not found in DB ──────────────────────────────────────────
      if (!activeTokenRecord) {
        // Reuse already-fetched member to determine 405 vs 401
        if (member) {
          _res.status(405).json({
            success: false,
            message: "Session expired. Please login again."
          });
          return;
        }
        throw new UnauthorizedError("Invalid token or user does not exist");
      }

      // ── 3b. Member validation ─────────────────────────────────────────────
      if (!member) {
        throw new UnauthorizedError("Member not found or account deleted");
      }

      if (member.status !== MemberStatus.ACTIVE) {
        throw new UnauthorizedError(`Account is ${member.status}. Please contact support.`);
      }

      // ── 4. Token rotation on expiry ───────────────────────────────────────
      if (isExpired) {
        const newToken = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          process.env.JWT_SECRET as string,
          { expiresIn: (process.env.JWT_EXPIRES_IN as any) || "30d" }
        );

        // Invalidate the old token's cache entry before replacing it in DB
        await invalidateAuthCache(token);

        activeTokenRecord.token = newToken;
        await tokenRepo.save(activeTokenRecord);

        _res.setHeader("x-new-token", newToken);
        _res.setHeader("Access-Control-Expose-Headers", "x-new-token");
        logger.debug("Mobile token regenerated", CTX, { userId: decodedId });
        // Do not cache the new token here — the client will use it on the next request
      } else {
        // ── 5. Populate Redis cache for future requests ───────────────────────
        const cacheData: CachedAuthData = {
          userId: member._id.toString(),
          status: member.status,
          isDeleted: member.isDeleted,
          tokenRecordExists: true
        };
        // Fire-and-forget: cache failure must never block the request
        setAuthCache(token, cacheData).catch(() => {/* swallowed */});
      }

      (req as any).user = {
        ...decoded,
        userId: decodedId,
        id: decodedId,
        userType: "MEMBER"
      };

      logger.debug(`Auth complete in ${Date.now() - t0}ms`, CTX, { userId: decodedId, cached: false });
      next();
    } catch (error: any) {
      handleErrorResponse(error, _res);
    }
  }
}
