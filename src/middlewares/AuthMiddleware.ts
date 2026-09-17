import {
  ExpressMiddlewareInterface,
  UnauthorizedError,
} from "routing-controllers";
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { AdminUser } from "../entity/AdminUser";
import { ObjectId } from "mongodb";
import { UserToken } from "../entity/UserToken";
import { Role } from "../entity/Role.Permission";
import { handleErrorResponse } from "../utils";

import { getAdminAuthCache, setAdminAuthCache } from "../services/authCache.service";

export interface AuthPayload {
  userId: string;
  companyId: string;
  role?: string | Role;
  roleId?: string;
  userType?: "ADMIN" | "ADMIN_USER" | "MEMBER";
}

export class AuthMiddleware implements ExpressMiddlewareInterface {
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      let token = "";
      const authHeader = req.headers.authorization;

      if (authHeader) {
        if (!authHeader.startsWith("Bearer ")) {
          throw new UnauthorizedError("Invalid authorization format");
        }
        token = authHeader.split(" ")[1];
      } else if (req.query && req.query.token && typeof req.query.token === "string") {
        token = req.query.token;
      } else {
        throw new UnauthorizedError("Authorization header missing");
      }

      let decoded: JwtPayload;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
      } catch (jwtErr: any) {
        throw new UnauthorizedError(jwtErr.message || "Invalid or expired token");
      }

      const decodedId = decoded.id || decoded.userId;

      if (!decoded || typeof decoded !== "object" || !decodedId) {
        console.error("Auth Error: Missing ID in payload", decoded);
        throw new Error("Invalid token payload");
      }

      // ── 1. Redis Cache Lookup (sub-millisecond hit, 0 DB round trips) ─────
      const cached = await getAdminAuthCache(token);
      if (cached) {
        if (!cached.tokenRecordExists) {
          throw new UnauthorizedError("Session expired. Another login detected.");
        }
        if (cached.isDeleted) {
          throw new UnauthorizedError("User not found or account deleted");
        }
        if (!cached.isActive) {
          throw new UnauthorizedError("Account is inactive. Please contact admin.");
        }

        (req as any).user = {
          ...decoded,
          userId: decodedId,
          id: decodedId,
          companyId: cached.companyId || decoded.companyId,
          roleId: cached.roleId || decoded.roleId,
          role: cached.role // attach cached full role object with permissions
        };

        return next();
      }

      // ── 2. DB Path (Cache Miss / Redis Outage) ─────────────────────────────
      const userId = decodedId;
      const adminUserRepo = AppDataSource.getMongoRepository(AdminUser);
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const roleRepo = AppDataSource.getMongoRepository(Role);

      // Safe Parallelization: Fetch AdminUser and UserToken concurrently
      const [user, activeTokenRecord] = await Promise.all([
        adminUserRepo.findOneBy({
          _id: new ObjectId(userId),
          isDeleted: false
        }),
        tokenRepo.findOneBy({
          userId: new ObjectId(userId),
          token: token
        })
      ]);

      if (!user) {
        throw new UnauthorizedError("User not found or account deleted");
      }

      if (!user.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact admin.");
      }

      if (!activeTokenRecord) {
        throw new UnauthorizedError("Session expired. Another login detected.");
      }

      // Load Role with permissions if user has a role assigned
      let role = null;
      if (user.roleId) {
        role = await roleRepo.findOneBy({
          _id: new ObjectId(user.roleId),
          isDeleted: false
        });
      }

      // ── 3. Populate Redis Cache for subsequent requests ───────────────────
      await setAdminAuthCache(token, {
        userId: decodedId,
        isActive: user.isActive,
        isDeleted: user.isDeleted,
        tokenRecordExists: true,
        companyId: (user as any).companyId?.toString() || decoded.companyId,
        roleId: user.roleId?.toString() || decoded.roleId,
        role: role
      });

      (req as any).user = {
        ...decoded,
        userId: decodedId,
        id: decodedId,
        companyId: (user as any).companyId?.toString() || decoded.companyId,
        roleId: user.roleId?.toString() || decoded.roleId,
        role: role // attach full role object with permissions
      };

      next();
    } catch (error: any) {
      handleErrorResponse(error, _res);
    }
  }
}
