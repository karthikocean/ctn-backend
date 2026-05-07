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
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
      const decodedId = decoded.id || decoded.userId;

      if (!decoded || typeof decoded !== "object" || !decodedId) {
        console.error("Auth Error: Missing ID in payload", decoded);
        throw new Error("Invalid token payload");
      }

      // Check if user is still active in database
      const userId = decodedId;
      let user: any = null;

      user = await AppDataSource.getMongoRepository(AdminUser).findOneBy({
        _id: new ObjectId(userId),
        isDeleted: false
      });

      if (!user) {
        throw new UnauthorizedError("User not found or account deleted");
      }

      if (!user.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact admin.");
      }

      // Load Role with permissions
      let role = null;
      if (user.roleId) {
        role = await AppDataSource.getMongoRepository(Role).findOneBy({
          _id: new ObjectId(user.roleId),
          isDeleted: false
        });
      }

      const activeTokenRecord = await AppDataSource.getMongoRepository(UserToken).findOneBy({
        userId: new ObjectId(userId),
        token: token
      });

      if (!activeTokenRecord) {
        throw new UnauthorizedError("Session expired. Another login detected.");
      }

      (req as any).user = {
        ...decoded,
        userId: decodedId,
        id: decodedId,
        companyId: user.companyId?.toString() || decoded.companyId,
        roleId: user.roleId?.toString() || decoded.roleId,
        role: role // attach full role object with permissions
      };

      next();
    } catch (error: any) {
      if (error instanceof UnauthorizedError) {
        handleErrorResponse(error, _res);
      }
      handleErrorResponse(error, _res);

    }
  }
}
