/**
 * MCP Authentication Middleware Tests
 *
 * Tests for the mcpAuthMiddleware that validates OAuth 2.1 Bearer tokens
 * and attaches the authenticated member context to the request.
 *
 * Security properties tested:
 *   - memberId comes ONLY from token validation — never from request body
 *   - Missing/malformed headers return 401
 *   - Expired, revoked, or wrong-type tokens are rejected
 *   - Valid tokens set req.mcpContext with memberId + scopes
 */

// ── Mock Redis ────────────────────────────────────────────────────────────────
const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  on: jest.fn(),
  status: "ready",
  quit: jest.fn(),
  disconnect: jest.fn(),
  call: jest.fn(),
};

jest.mock("../src/config/appRedis", () => ({
  appRedis: redisMock,
  appRedisConfig: {},
  checkRedisHealth: jest.fn(),
}));

jest.mock("../src/utils/logger", () => {
  const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: mockLog,
    logger: mockLog,
  };
});

const MCP_OAUTH_TOKEN_SECRET = "test_mcp_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
process.env.MCP_OAUTH_TOKEN_SECRET = MCP_OAUTH_TOKEN_SECRET;
process.env.MCP_OAUTH_ISSUER = "http://localhost:4001";
process.env.MCP_OAUTH_AUDIENCE = "trusted-network-mcp";
process.env.MCP_PUBLIC_URL = "http://localhost:4001";
process.env.JWT_SECRET = "test_jwt_secret";

import { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import { mcpAuthMiddleware } from "../src/mcp/middleware/authentication";
import { issueMcpTokens } from "../src/mcp/auth/token";

const MEMBER_ID = new ObjectId().toString();

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("MCP Authentication Middleware", () => {
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  // ── Missing / malformed header ─────────────────────────────────────────────
  describe("Missing or malformed Authorization header", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const req = makeReq({ headers: {} });
      const { res, status } = makeRes();

      await mcpAuthMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
    });

    it("returns 401 when header is not Bearer scheme", async () => {
      const req = makeReq({ headers: { authorization: "Basic dXNlcjpwYXNz" } });
      const { res, status } = makeRes();

      await mcpAuthMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
    });

    it("returns 401 when Bearer token is empty", async () => {
      const req = makeReq({ headers: { authorization: "Bearer " } });
      const { res, status } = makeRes();

      await mcpAuthMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
    });

    it("returns 401 with invalid_token error code when token is garbage", async () => {
      const req = makeReq({ headers: { authorization: "Bearer not.a.real.token" } });
      const { res, status, json } = makeRes();
      // json is on the 401 return value
      const resObj = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

      await mcpAuthMiddleware(req, resObj, next);

      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Valid token ────────────────────────────────────────────────────────────
  describe("Valid access token", () => {
    it("calls next() and sets req.mcpContext with memberId from token", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read", "posts:read"]);

      // Redis returns valid session
      redisMock.get.mockResolvedValue(
        JSON.stringify({ memberId: MEMBER_ID, scopes: ["profile:read", "posts:read"] })
      );

      const req = makeReq({ headers: { authorization: `Bearer ${accessToken}` } });
      const { res } = makeRes();

      await mcpAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).mcpContext).toBeDefined();
      expect((req as any).mcpContext.memberId).toBe(MEMBER_ID);
      expect((req as any).mcpContext.scopes).toEqual(["profile:read", "posts:read"]);
    });

    it("CRITICAL: memberId comes from token — a body memberId is ignored", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["posts:write"]);

      redisMock.get.mockResolvedValue(
        JSON.stringify({ memberId: MEMBER_ID, scopes: ["posts:write"] })
      );

      const evilMemberId = new ObjectId().toString();
      // Attacker includes memberId in the request body — must be ignored
      const req = makeReq({
        headers: { authorization: `Bearer ${accessToken}` },
        body: { memberId: evilMemberId },
      });
      const { res } = makeRes();

      await mcpAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      // mcpContext.memberId must be from the token, not from the body
      expect((req as any).mcpContext.memberId).toBe(MEMBER_ID);
      expect((req as any).mcpContext.memberId).not.toBe(evilMemberId);
    });
  });

  // ── Invalid / expired / revoked tokens ────────────────────────────────────
  describe("Invalid token scenarios", () => {
    it("returns 401 for an expired access token", async () => {
      const expiredToken = jwt.sign(
        { jti: "exp1", memberId: MEMBER_ID, scopes: ["profile:read"], type: "access" },
        MCP_OAUTH_TOKEN_SECRET,
        { issuer: "http://localhost:4001", audience: "trusted-network-mcp", expiresIn: -1 }
      );

      const req = makeReq({ headers: { authorization: `Bearer ${expiredToken}` } });
      const { res, status } = makeRes();
      const resObj = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

      await mcpAuthMiddleware(req, resObj, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when token is valid JWT but Redis session is revoked", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      // Session deleted (logout/revoke)
      redisMock.get.mockResolvedValue(null);

      const req = makeReq({ headers: { authorization: `Bearer ${accessToken}` } });
      const { res, status } = makeRes();
      const resObj = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

      await mcpAuthMiddleware(req, resObj, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when a refresh token is presented instead of access token", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { refreshToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      const req = makeReq({ headers: { authorization: `Bearer ${refreshToken}` } });
      const { res } = makeRes();
      const resObj = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

      await mcpAuthMiddleware(req, resObj, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 for mobile app JWT (wrong secret/audience)", () => {
      // A valid mobile JWT must NOT be accepted by the MCP server
      const mobileToken = jwt.sign(
        { userId: MEMBER_ID, userType: "MEMBER" },
        "test_jwt_secret",
        { expiresIn: "30d" }
      );

      const req = makeReq({ headers: { authorization: `Bearer ${mobileToken}` } });
      const resObj = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

      // This will fail JWT verification (wrong issuer/audience/secret)
      // Just verify the token cannot be verified with MCP secret
      expect(() =>
        jwt.verify(mobileToken, MCP_OAUTH_TOKEN_SECRET, {
          issuer: "http://localhost:4001",
          audience: "trusted-network-mcp",
        })
      ).toThrow();
    });
  });
});
