/**
 * Tests for Session and Token Invalidation across MobileAuthMiddleware, AuthMiddleware, and SocketAuth.
 */

import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { MobileAuthMiddleware } from "../src/middlewares/MobileAuthMiddleware";
import { AuthMiddleware } from "../src/middlewares/AuthMiddleware";
import { AppDataSource } from "../src/data-source";

const JWT_SECRET = "test_jwt_secret_key_1234567890";
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRES_IN = "30d";

describe("Session & Token Invalidation", () => {
  const memberId = new ObjectId().toString();
  const validToken = jwt.sign({ userId: memberId, userType: "MEMBER" }, JWT_SECRET, { expiresIn: "1h" });
  const expiredToken = jwt.sign({ userId: memberId, userType: "MEMBER" }, JWT_SECRET, { expiresIn: "-1h" });

  describe("MobileAuthMiddleware", () => {
    let middleware: MobileAuthMiddleware;
    let mockReq: any;
    let mockRes: any;
    let mockNext: jest.Mock;

    beforeEach(() => {
      middleware = new MobileAuthMiddleware();
      mockReq = {
        headers: {
          authorization: `Bearer ${validToken}`
        }
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        headersSent: false
      };
      mockNext = jest.fn();
    });

    test("1. Active session in UserToken -> request proceeds", async () => {
      // Mock UserToken found
      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity.name === "UserToken") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ userId: new ObjectId(memberId), token: validToken }),
            save: jest.fn().mockResolvedValue({})
          } as any;
        }
        if (entity.name === "Member") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(memberId), status: "active", isDeleted: false })
          } as any;
        }
        return {} as any;
      });

      await middleware.use(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user.userId).toBe(memberId);
    });

    test("2. Revoked/deleted session in UserToken (member exists) -> returns 405 Session Expired (CTN client contract)", async () => {
      // Mock UserToken NOT found (session revoked/logged out)
      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity.name === "UserToken") {
          return {
            findOneBy: jest.fn().mockResolvedValue(null) // Token not in DB
          } as any;
        }
        if (entity.name === "Member") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(memberId), status: "active", isDeleted: false })
          } as any;
        }
        return {} as any;
      });

      await middleware.use(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(405);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining("Session expired")
      }));
    });

    test("3. Missing token header -> returns 401 Unauthorized", async () => {
      mockReq.headers = {};

      await middleware.use(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    test("4. Expired JWT with active UserToken in DB -> auto-refreshes token", async () => {
      mockReq.headers.authorization = `Bearer ${expiredToken}`;
      const activeRecord = { userId: new ObjectId(memberId), token: expiredToken };

      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity.name === "UserToken") {
          return {
            findOneBy: jest.fn().mockResolvedValue(activeRecord),
            save: jest.fn().mockResolvedValue({})
          } as any;
        }
        if (entity.name === "Member") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(memberId), status: "active", isDeleted: false })
          } as any;
        }
        return {} as any;
      });

      await middleware.use(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith("x-new-token", expect.any(String));
    });
  });

  describe("Admin AuthMiddleware", () => {
    let middleware: AuthMiddleware;
    let mockReq: any;
    let mockRes: any;
    let mockNext: jest.Mock;
    const adminId = new ObjectId().toString();
    const adminToken = jwt.sign({ id: adminId, userType: "ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

    beforeEach(() => {
      middleware = new AuthMiddleware();
      mockReq = {
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false
      };
      mockNext = jest.fn();
    });

    test("1. Active admin session in UserToken -> request proceeds", async () => {
      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity.name === "AdminUser") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(adminId), isActive: true, isDeleted: false })
          } as any;
        }
        if (entity.name === "UserToken") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ userId: new ObjectId(adminId), token: adminToken })
          } as any;
        }
        return { findOneBy: jest.fn().mockResolvedValue(null) } as any;
      });

      await middleware.use(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user.id).toBe(adminId);
    });

    test("2. Revoked admin session in UserToken (logged out) -> returns 401 Unauthorized", async () => {
      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity.name === "AdminUser") {
          return {
            findOneBy: jest.fn().mockResolvedValue({ _id: new ObjectId(adminId), isActive: true, isDeleted: false })
          } as any;
        }
        if (entity.name === "UserToken") {
          return {
            findOneBy: jest.fn().mockResolvedValue(null) // Revoked session
          } as any;
        }
        return { findOneBy: jest.fn().mockResolvedValue(null) } as any;
      });

      await middleware.use(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});
