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

export class MobileAuthMiddleware implements ExpressMiddlewareInterface {
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
      const decodedId = decoded.userId || decoded.id;

      if (!decoded || typeof decoded !== "object" || !decodedId) {
        console.error("Mobile Auth Error: Missing ID in payload", decoded);
        throw new Error("Invalid token payload");
      }

      // Check if member is still active in database
      const memberRepo = AppDataSource.getMongoRepository(Member);
      const member = await memberRepo.findOneBy({
        _id: new ObjectId(decodedId),
        isDeleted: false
      });

      if (!member) {
        throw new UnauthorizedError("Member not found or account deleted");
      }

      if (member.status !== MemberStatus.ACTIVE) {
        throw new UnauthorizedError(`Account is ${member.status}. Please contact support.`);
      }

      // Verify token exists in database (session management)
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const activeTokenRecord = await tokenRepo.findOneBy({
        userId: new ObjectId(decodedId),
        token: token
      });

      if (!activeTokenRecord) {
        throw new UnauthorizedError("Session expired. Please login again.");
      }

      (req as any).user = {
        ...decoded,
        userId: decodedId,
        id: decodedId,
        userType: "MEMBER"
      };

      next();
    } catch (error: any) {
      handleErrorResponse(error, _res);
    }
  }
}
