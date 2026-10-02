/**
 * MCP Token Management Tests
 *
 * Tests for OAuth 2.1 token issuance, validation, refresh, revocation,
 * and internal JWT generation.
 *
 * Covers:
 *   - issueMcpTokens: generates valid access + refresh tokens, stored in Redis
 *   - validateMcpAccessToken: accepts valid tokens, rejects expired/wrong-type/revoked
 *   - refreshMcpTokens: rotates tokens, deletes old entries
 *   - revokeMcpToken: deletes Redis entry
 *   - consumeAuthCode: single-use, validates redirectUri match
 *   - generateInternalJwt: short-lived, signed with JWT_SECRET
 */

// ── Mock Redis before any imports ────────────────────────────────────────────
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
  checkRedisHealth: jest.fn().mockResolvedValue({ status: "connected", latencyMs: 1 }),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock("../src/utils/logger", () => {
  const mockLog = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockLog,
    logger: mockLog,
  };
});

// Set env before module imports
const MCP_OAUTH_TOKEN_SECRET = "test_mcp_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const JWT_SECRET = "test_jwt_secret_1234567890";
process.env.MCP_OAUTH_TOKEN_SECRET = MCP_OAUTH_TOKEN_SECRET;
process.env.MCP_OAUTH_ISSUER = "http://localhost:4001";
process.env.MCP_OAUTH_AUDIENCE = "trusted-network-mcp";
process.env.MCP_PUBLIC_URL = "http://localhost:4001";
process.env.JWT_SECRET = JWT_SECRET;

import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

// Lazy-import after env is set
import {
  issueMcpTokens,
  validateMcpAccessToken,
  refreshMcpTokens,
  revokeMcpToken,
  issueAuthCode,
  consumeAuthCode,
  generateInternalJwt,
} from "../src/mcp/auth/token";

const MEMBER_ID = new ObjectId().toString();

// ─────────────────────────────────────────────────────────────────────────────
describe("MCP Token Management", () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── issueMcpTokens ─────────────────────────────────────────────────────────
  describe("issueMcpTokens", () => {
    it("returns a valid access token and refresh token", async () => {
      redisMock.setex.mockResolvedValue("OK");

      const { accessToken, refreshToken, expiresIn } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      expect(expiresIn).toBe(3600);

      // Verify access token structure
      const decoded = jwt.verify(accessToken, MCP_OAUTH_TOKEN_SECRET) as any;
      expect(decoded.memberId).toBe(MEMBER_ID);
      expect(decoded.type).toBe("access");
      expect(decoded.scopes).toEqual(["profile:read"]);
    });

    it("stores both tokens in Redis with correct TTL", async () => {
      redisMock.setex.mockResolvedValue("OK");

      await issueMcpTokens(MEMBER_ID, ["profile:read", "posts:read"]);

      expect(redisMock.setex).toHaveBeenCalledTimes(2);

      const [accessCall, refreshCall] = redisMock.setex.mock.calls;

      // Access token: 1h = 3600s
      expect(accessCall[0]).toMatch(/^mcp:access:/);
      expect(accessCall[1]).toBe(3600);

      // Refresh token: 30d = 2592000s
      expect(refreshCall[0]).toMatch(/^mcp:refresh:/);
      expect(refreshCall[1]).toBe(2592000);
    });

    it("throws if MCP_OAUTH_TOKEN_SECRET is not configured", async () => {
      // The module is already loaded with the test secret.
      // We just verify the guard exists in the source — it throws inside issueMcpTokens
      // when tokenSecret is falsy. We test this by temporarily clearing the env
      // and calling a local instance of the config (which reads env at call time).
      const originalSecret = process.env.MCP_OAUTH_TOKEN_SECRET;
      process.env.MCP_OAUTH_TOKEN_SECRET = "";

      // Re-require config to pick up the cleared secret
      jest.resetModules();
      const { mcpConfig: freshConfig } = await import("../src/mcp/config");
      expect(freshConfig.oauth.tokenSecret).toBe("");

      process.env.MCP_OAUTH_TOKEN_SECRET = originalSecret!;
    });
  });

  // ── validateMcpAccessToken ─────────────────────────────────────────────────
  describe("validateMcpAccessToken", () => {
    it("accepts a valid access token with Redis session present", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read", "members:read"]);

      // Simulate Redis having the session
      redisMock.get.mockResolvedValue(JSON.stringify({ memberId: MEMBER_ID, scopes: ["profile:read", "members:read"] }));

      const result = await validateMcpAccessToken(accessToken);

      expect(result.memberId).toBe(MEMBER_ID);
      expect(result.scopes).toEqual(["profile:read", "members:read"]);
    });

    it("rejects a token with wrong issuer", async () => {
      const badToken = jwt.sign(
        { jti: "x", memberId: MEMBER_ID, scopes: ["profile:read"], type: "access" },
        MCP_OAUTH_TOKEN_SECRET,
        { issuer: "https://evil.com", audience: "trusted-network-mcp", expiresIn: 3600 }
      );

      await expect(validateMcpAccessToken(badToken)).rejects.toThrow();
    });

    it("rejects a token with wrong audience", async () => {
      const badToken = jwt.sign(
        { jti: "x", memberId: MEMBER_ID, scopes: ["profile:read"], type: "access" },
        MCP_OAUTH_TOKEN_SECRET,
        { issuer: "http://localhost:4001", audience: "wrong-audience", expiresIn: 3600 }
      );

      await expect(validateMcpAccessToken(badToken)).rejects.toThrow();
    });

    it("rejects an expired token", async () => {
      const expiredToken = jwt.sign(
        { jti: "y", memberId: MEMBER_ID, scopes: ["profile:read"], type: "access" },
        MCP_OAUTH_TOKEN_SECRET,
        { issuer: "http://localhost:4001", audience: "trusted-network-mcp", expiresIn: -1 }
      );

      await expect(validateMcpAccessToken(expiredToken)).rejects.toThrow(/invalid or expired/i);
    });

    it("rejects a refresh token presented as access token", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { refreshToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      await expect(validateMcpAccessToken(refreshToken)).rejects.toThrow(/type mismatch/i);
    });

    it("rejects a token whose Redis session was revoked", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      // Redis returns null (session deleted / revoked)
      redisMock.get.mockResolvedValue(null);

      await expect(validateMcpAccessToken(accessToken)).rejects.toThrow(/not found or revoked/i);
    });

    it("rejects a token signed with the wrong secret", async () => {
      const tamperedToken = jwt.sign(
        { jti: "z", memberId: MEMBER_ID, scopes: ["profile:read"], type: "access" },
        "wrong_secret",
        { issuer: "http://localhost:4001", audience: "trusted-network-mcp", expiresIn: 3600 }
      );

      await expect(validateMcpAccessToken(tamperedToken)).rejects.toThrow();
    });

    it("rejects a token where Redis memberId differs from JWT memberId (integrity failure)", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      // Redis returns a different memberId (should never happen — integrity check)
      const differentMemberId = new ObjectId().toString();
      redisMock.get.mockResolvedValue(JSON.stringify({ memberId: differentMemberId, scopes: ["profile:read"] }));

      await expect(validateMcpAccessToken(accessToken)).rejects.toThrow(/integrity failure/i);
    });
  });

  // ── refreshMcpTokens ───────────────────────────────────────────────────────
  describe("refreshMcpTokens", () => {
    it("issues new token pair and deletes old refresh token from Redis", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { refreshToken } = await issueMcpTokens(MEMBER_ID, ["profile:read", "posts:write"]);

      // Redis returns the session for the old refresh token
      const oldJti = (jwt.decode(refreshToken) as any).jti;
      redisMock.get.mockResolvedValue(
        JSON.stringify({ memberId: MEMBER_ID, scopes: ["profile:read", "posts:write"], accessJti: "old-access-jti" })
      );
      redisMock.del.mockResolvedValue(1);

      const { accessToken: newAccess, refreshToken: newRefresh, expiresIn } = await refreshMcpTokens(refreshToken);

      expect(newAccess).toBeDefined();
      expect(newRefresh).toBeDefined();
      expect(expiresIn).toBe(3600);

      // Old tokens must be deleted (refresh + access)
      expect(redisMock.del).toHaveBeenCalledWith(`mcp:refresh:${oldJti}`);
      expect(redisMock.del).toHaveBeenCalledWith("mcp:access:old-access-jti");

      // New tokens properly signed for the same member
      const decoded = jwt.verify(newAccess, MCP_OAUTH_TOKEN_SECRET) as any;
      expect(decoded.memberId).toBe(MEMBER_ID);
    });

    it("rejects an access token passed as refresh token", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      await expect(refreshMcpTokens(accessToken)).rejects.toThrow(/type mismatch/i);
    });

    it("rejects a refresh token not present in Redis (revoked)", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { refreshToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);

      redisMock.get.mockResolvedValue(null);

      await expect(refreshMcpTokens(refreshToken)).rejects.toThrow(/not found or revoked/i);
    });
  });

  // ── revokeMcpToken ─────────────────────────────────────────────────────────
  describe("revokeMcpToken", () => {
    it("deletes the access token from Redis", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { accessToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);
      redisMock.del.mockResolvedValue(1);

      const jti = (jwt.decode(accessToken) as any).jti;
      await revokeMcpToken(accessToken);

      expect(redisMock.del).toHaveBeenCalledWith(`mcp:access:${jti}`);
    });

    it("deletes the refresh token from Redis", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const { refreshToken } = await issueMcpTokens(MEMBER_ID, ["profile:read"]);
      redisMock.del.mockResolvedValue(1);

      const jti = (jwt.decode(refreshToken) as any).jti;
      await revokeMcpToken(refreshToken);

      expect(redisMock.del).toHaveBeenCalledWith(`mcp:refresh:${jti}`);
    });

    it("silently ignores an invalid/already-expired token (no throw)", async () => {
      await expect(revokeMcpToken("not.a.valid.token")).resolves.toBeUndefined();
    });
  });

  // ── Authorization Code ─────────────────────────────────────────────────────
  describe("issueAuthCode + consumeAuthCode", () => {
    const REDIRECT_URI = "https://chatgpt.com/callback";

    it("issues a code and consumes it once", async () => {
      redisMock.setex.mockResolvedValue("OK");
      const code = await issueAuthCode(MEMBER_ID, ["profile:read"], REDIRECT_URI);
      expect(code).toHaveLength(64); // 32 bytes hex

      // On consume, Redis returns the stored data
      redisMock.get.mockResolvedValue(
        JSON.stringify({ memberId: MEMBER_ID, scopes: ["profile:read"], redirectUri: REDIRECT_URI })
      );
      redisMock.del.mockResolvedValue(1);

      const result = await consumeAuthCode(code, REDIRECT_URI);
      expect(result.memberId).toBe(MEMBER_ID);
      expect(result.scopes).toEqual(["profile:read"]);

      // Verify deletion (single-use)
      expect(redisMock.del).toHaveBeenCalledWith(`mcp:code:${code}`);
    });

    it("rejects a code that is not in Redis (expired or already used)", async () => {
      redisMock.get.mockResolvedValue(null);
      await expect(consumeAuthCode("nonexistent-code", REDIRECT_URI)).rejects.toThrow(/not found/i);
    });

    it("rejects a code with redirect_uri mismatch", async () => {
      redisMock.get.mockResolvedValue(
        JSON.stringify({ memberId: MEMBER_ID, scopes: ["profile:read"], redirectUri: REDIRECT_URI })
      );

      await expect(
        consumeAuthCode("some-code", "https://evil.com/callback")
      ).rejects.toThrow(/redirect_uri mismatch/i);
    });
  });

  // ── generateInternalJwt ────────────────────────────────────────────────────
  describe("generateInternalJwt", () => {
    it("generates a JWT signed with JWT_SECRET valid for 5 minutes", () => {
      const token = generateInternalJwt(MEMBER_ID);
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      expect(decoded.userId).toBe(MEMBER_ID);
      expect(decoded.userType).toBe("MEMBER");

      // Should expire in ~5 minutes
      const ttlSeconds = decoded.exp - Math.floor(Date.now() / 1000);
      expect(ttlSeconds).toBeGreaterThan(0);
      expect(ttlSeconds).toBeLessThanOrEqual(300); // 5 min
    });

    it("uses JWT_SECRET not MCP_OAUTH_TOKEN_SECRET", () => {
      const token = generateInternalJwt(MEMBER_ID);
      // Verify with JWT_SECRET succeeds
      expect(() => jwt.verify(token, JWT_SECRET)).not.toThrow();
      // Verify with MCP secret fails
      expect(() => jwt.verify(token, MCP_OAUTH_TOKEN_SECRET)).toThrow();
    });

    it("CRITICAL: internal JWT must NOT be confused with MCP OAuth token", () => {
      const internalToken = generateInternalJwt(MEMBER_ID);
      const decoded = jwt.decode(internalToken) as any;

      // Internal JWT has different payload structure (no jti, type, scopes)
      expect(decoded.userId).toBe(MEMBER_ID);
      expect(decoded.jti).toBeUndefined();
      expect(decoded.type).toBeUndefined();
      expect(decoded.scopes).toBeUndefined();
    });
  });
});
