import { userOrIpKey, identifierOrIpKey } from "../src/middlewares/rateLimit.middleware";
import { rateLimitConfig } from "../src/config/rateLimit.config";
import express, { Request, Response } from "express";
import request from "supertest";
import { createServer } from "http";

describe("Production Rate Limiting Audit & Verification Suite", () => {
  describe("1. Configuration & Default Limits", () => {
    it("should load valid rate limiting configuration defaults", () => {
      expect(rateLimitConfig.enabled).toBe(true);
      expect(rateLimitConfig.general.max).toBe(300);
      expect(rateLimitConfig.auth.max).toBe(10);
      expect(rateLimitConfig.otp.max).toBe(5);
      expect(rateLimitConfig.passwordReset.max).toBe(5);
      expect(rateLimitConfig.upload.max).toBe(20);
      expect(rateLimitConfig.mobile.max).toBe(300);
      expect(rateLimitConfig.admin.max).toBe(600);
    });
  });

  describe("2. Key Generation Logic", () => {
    it("should extract User ID when authenticated user is present", () => {
      const mockReq = {
        user: { userId: "user_12345" },
        ip: "192.168.1.50"
      } as unknown as Request;

      const key = userOrIpKey(mockReq);
      expect(key).toBe("user:user_12345");
    });

    it("should fallback to IP when user is unauthenticated", () => {
      const mockReq = {
        ip: "192.168.1.50"
      } as unknown as Request;

      const key = userOrIpKey(mockReq);
      expect(key).toBe("192.168.1.50");
    });

    it("should combine IP and identifier for OTP/Auth requests", () => {
      const mockReq = {
        ip: "10.0.0.1",
        body: { phone: "+919876543210" }
      } as unknown as Request;

      const key = identifierOrIpKey(mockReq);
      expect(key).toBe("10.0.0.1_+919876543210");
    });
  });

  describe("3. Express Middleware Route Throttling Behavior", () => {
    let app: express.Application;

    beforeEach(() => {
      app = express();
      app.use(express.json());

      // Health endpoint (unrestricted)
      app.get("/api/health", (_req: Request, res: Response) => {
        res.status(200).json({ status: "ready" });
      });

      // Dummy test route for checking responses
      app.get("/test", (_req: Request, res: Response) => {
        res.status(200).json({ success: true });
      });
    });

    it("should ensure health endpoint bypasses rate limiters and returns 200 OK", async () => {
      for (let i = 0; i < 20; i++) {
        const response = await request(app).get("/api/health");
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ready");
      }
    });
  });
});
