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

      // 1. Verify / decode JWT structure
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
        console.error("Mobile Auth Error: Missing or invalid ID in payload", decoded);
        throw new UnauthorizedError("Invalid token payload");
      }

      // 2. Verify Session in database (UserToken record matching this user + token)
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const activeTokenRecord = await tokenRepo.findOneBy({
        userId: new ObjectId(decodedId),
        token: token
      });

      if (!activeTokenRecord) {
        // Token was deleted / invalidated (logout, PIN change, session revoke).
        // Check if member exists in database to return CTN's custom 405 response for client redirection.
        const memberRepo = AppDataSource.getMongoRepository(Member);
        const member = await memberRepo.findOneBy({
          _id: new ObjectId(decodedId),
          isDeleted: false
        });

        if (member) {
          _res.status(405).json({
            success: false,
            message: "Session expired. Please login again."
          });
          return;
        }

        throw new UnauthorizedError("Invalid token or user does not exist");
      }

      // 3. Verify Member account status in database
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

      // 4. Token Refresh on expiry (if session was valid in DB)
      if (isExpired) {
        const newToken = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          process.env.JWT_SECRET as string,
          { expiresIn: (process.env.JWT_EXPIRES_IN as any) || "30d" }
        );

        activeTokenRecord.token = newToken;
        await tokenRepo.save(activeTokenRecord);

        _res.setHeader("x-new-token", newToken);
        _res.setHeader("Access-Control-Expose-Headers", "x-new-token");
        console.log(`Mobile token regenerated and updated for user: ${decodedId}`);
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
