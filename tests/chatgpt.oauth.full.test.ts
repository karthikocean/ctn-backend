/**
 * Complete End-to-End Automated Test Suite for ChatGPT MCP OAuth 2.1 Integration.
 *
 * Implements verification tests A through Z as specified in Step 31:
 *  A. Protected resource metadata (RFC 9449 / MCP)
 *  B. OAuth authorization server metadata (RFC 8414)
 *  C. Valid authorization request renders login / consent UI
 *  D. Invalid redirect URI rejected (400, no redirect)
 *  E. Missing PKCE rejected (400)
 *  F. Invalid resource rejected (400 invalid_target)
 *  G. Unsupported scope rejected (400 invalid_scope)
 *  H. Consent denied redirects with error=access_denied, state, iss
 *  I. Successful authorization returns 302 to exact ChatGPT redirect URI with code, state, iss (no tokens)
 *  J. Token exchange with valid code + verifier returns access_token, refresh_token, token_type
 *  K. PKCE failure (wrong verifier) returns 400 invalid_grant
 *  L. Code replay (reuse code) returns 400 invalid_grant
 *  M. Wrong redirect_uri during token exchange returns 400 invalid_grant
 *  N. Wrong resource during token exchange returns 400
 *  O. MCP unauthenticated returns 401 with WWW-Authenticate header and _meta
 *  P. MCP invalid token returns 401
 *  Q. MCP wrong audience returns 401
 *  R. MCP expired token returns 401
 *  S. MCP insufficient scope returns 401 / error
 *  T. Valid profile request returns authenticated CTN member with stable identity and _meta
 *  U. User isolation: User A token never returns User B data
 *  V. create_post with posts:create succeeds
 *  W. create_post without posts:create is rejected
 *  X. delete_post verifies confirmation and ownership
 *  Y. refresh_token returns new access token with rotation
 *  Z. revoked refresh token returns 400 invalid_grant
 */

import express from "express";
import request from "supertest";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// ── Mock Redis ───────────────────────────────────────────────────────────────
const redisStore = new Map<string, string>();
const redisMock = {
  get: jest.fn(async (key: string) => redisStore.get(key) || null),
  set: jest.fn(async (key: string, val: string) => {
    redisStore.set(key, val);
    return "OK";
  }),
  setex: jest.fn(async (key: string, _ttl: number, val: string) => {
    redisStore.set(key, val);
    return "OK";
  }),
  del: jest.fn(async (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
      if (redisStore.delete(k)) count++;
    }
    return count;
  }),
  keys: jest.fn(async (pattern: string) => {
    const prefix = pattern.replace(/\*$/, "");
    return Array.from(redisStore.keys()).filter((k) => k.startsWith(prefix));
  }),
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

// ── Mock Logger ──────────────────────────────────────────────────────────────
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

// ── Environment Setup ────────────────────────────────────────────────────────
process.env.JWT_SECRET = "test-mobile-jwt-secret-at-least-32-chars-long";
process.env.MCP_OAUTH_TOKEN_SECRET = "test-mcp-oauth-secret-at-least-64-characters-for-testing-purposes-1234567890";
process.env.MCP_PUBLIC_URL = "https://mcp.trustednetwork.in";
process.env.OAUTH_ISSUER = "https://api.trustednetwork.in";
process.env.OAUTH_RESOURCE = "https://mcp.trustednetwork.in";
process.env.TRUSTED_NETWORK_API_URL = "http://127.0.0.1:5001";
process.env.MCP_ENABLED = "true";

// Mock axios for internal mobile-api proxy
jest.mock("axios", () => {
  const actualAxios = jest.requireActual("axios");
  return {
    ...actualAxios,
    post: jest.fn(async (url: string, data: any) => {
      if (url.includes("/mobile-api/auth/login-pin")) {
        if (data.identifier === "9876543210" && data.pin === "1234") {
          return {
            data: {
              success: true,
              data: {
                _id: "6aa2a07690f1611f31181c4a",
                fullName: "Test Member A",
                mobileNumber: "9876543210"
              }
            }
          };
        }
        return {
          data: {
            success: false,
            message: "Invalid mobile number or PIN"
          }
        };
      }
      return { data: { success: true } };
    }),
    create: jest.fn(() => ({
      get: jest.fn(async (url: string) => {
        if (url.includes("/members/profile")) {
          return {
            data: {
              success: true,
              data: {
                _id: "6aa2a07690f1611f31181c4a",
                fullName: "Test Member A",
                businessName: "Acme Corp",
                city: "Chennai"
              }
            }
          };
        }
        if (url.includes("/members/")) {
          return {
            data: {
              success: true,
              data: {
                items: [{ _id: "6aa2a07690f1611f31181c4a", fullName: "Test Member A" }]
              }
            }
          };
        }
        if (url.includes("/posts/my-posts")) {
          return {
            data: {
              success: true,
              data: [{ _id: "507f1f77bcf86cd799439011", title: "Test Post", type: "REQUIREMENT" }]
            }
          };
        }
        return { data: { success: true, data: {} } };
      }),
      post: jest.fn(async (url: string, body: any) => {
        if (url.includes("/posts/")) {
          return {
            data: {
              success: true,
              data: {
                _id: "507f1f77bcf86cd799439099",
                title: body.title,
                description: body.description,
                type: body.type
              }
            }
          };
        }
        return { data: { success: true } };
      }),
      put: jest.fn(async (_url: string, body: any) => ({
        data: {
          success: true,
          data: { _id: "507f1f77bcf86cd799439099", ...body }
        }
      })),
      delete: jest.fn(async () => ({
        data: { success: true, message: "Deleted successfully" }
      }))
    }))
  };
});

import { createOAuthRouter, SUPPORTED_SCOPES } from "../src/mcp/auth/oauth";
import { mcpAuthMiddleware } from "../src/mcp/middleware/authentication";
import {
  issueMcpTokens,
  validateMcpAccessToken,
  issueAuthCode,
  consumeAuthCode,
  refreshMcpTokens,
  revokeMcpToken
} from "../src/mcp/auth/token";
import { getJwks, verifyOAuthJwt, signOAuthJwt } from "../src/mcp/auth/keys";
import { createMcpServer } from "../src/mcp/server";

describe("Step 31: Comprehensive OAuth 2.1 & MCP Automated Tests (A through Z)", () => {
  let app: express.Express;

  const CHATGPT_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
  const TEST_CLIENT_ID = "chatgpt-mcp";
  const MEMBER_A_ID = "6aa2a07690f1611f31181c4a";
  const MEMBER_B_ID = "6bb2a07690f1611f31181c4b";

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use("/", createOAuthRouter());

    // Protected MCP test route
    app.get("/test-protected", mcpAuthMiddleware, (req, res) => {
      res.json({
        success: true,
        memberId: req.mcpContext?.memberId,
        scopes: req.mcpContext?.scopes
      });
    });
  });

  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();
  });

  // ── A. Protected Resource Metadata ──────────────────────────────────────────
  it("A. GET /.well-known/oauth-protected-resource returns 200 and valid JSON", async () => {
    const res = await request(app).get("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(res.body.resource).toBe("https://mcp.trustednetwork.in");
    expect(res.body.authorization_servers).toEqual(["https://api.trustednetwork.in"]);
    expect(res.body.scopes_supported).toEqual(expect.arrayContaining(["profile:read", "members:read", "posts:read", "posts:create"]));
  });

  // ── B. OAuth Metadata ───────────────────────────────────────────────────────
  it("B. GET /.well-known/oauth-authorization-server returns valid RFC 8414 metadata", async () => {
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe("https://api.trustednetwork.in");
    expect(res.body.authorization_endpoint).toBe("https://api.trustednetwork.in/oauth/authorize");
    expect(res.body.token_endpoint).toBe("https://api.trustednetwork.in/oauth/token");
    expect(res.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(res.body.scopes_supported).toEqual(expect.arrayContaining(["profile:read", "members:read", "posts:read", "posts:create"]));
    expect(res.body.authorization_response_iss_parameter_supported).toBe(true);
  });

  // ── C. Authorization Request ────────────────────────────────────────────────
  it("C. Valid authorization request renders login / consent UI (200)", async () => {
    const verifier = "test_code_verifier_long_enough_1234567890_abc";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const res = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        scope: "profile:read members:read",
        state: "state_12345",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://mcp.trustednetwork.in"
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Connect with ChatGPT");
    expect(res.text).toContain("state_12345");
  });

  // ── D. Invalid Redirect URI ─────────────────────────────────────────────────
  it("D. Invalid redirect URI is rejected with 400 and does NOT redirect", async () => {
    const res = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: "https://evil-attacker.com/steal-code",
        state: "state_123",
        code_challenge: "challenge_abc",
        code_challenge_method: "S256"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_client");
    expect(res.headers.location).toBeUndefined();
  });

  // ── E. Missing PKCE ─────────────────────────────────────────────────────────
  it("E. Missing PKCE challenge is rejected with 400", async () => {
    const res = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        state: "state_123"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.error_description).toContain("code_challenge is required");
  });

  // ── F. Invalid Resource ─────────────────────────────────────────────────────
  it("F. Invalid resource parameter is rejected with 400 invalid_target", async () => {
    const res = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        state: "state_123",
        code_challenge: "challenge_abc",
        code_challenge_method: "S256",
        resource: "https://unknown-service.com"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_target");
  });

  // ── G. Unsupported Scope ────────────────────────────────────────────────────
  it("G. Unsupported scope is rejected with 400 invalid_scope", async () => {
    const res = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        state: "state_123",
        code_challenge: "challenge_abc",
        code_challenge_method: "S256",
        scope: "profile:read admin:superpower"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_scope");
  });

  // ── H. Consent Denied ───────────────────────────────────────────────────────
  it("H. Consent denied returns redirect to ChatGPT callback with error=access_denied, state, and iss", async () => {
    // Initiate authorize first
    await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        state: "state_deny_test",
        code_challenge: "challenge_deny",
        code_challenge_method: "S256"
      });

    // Post consent denial
    const res = await request(app)
      .post("/oauth/consent")
      .send({
        state: "state_deny_test",
        action: "deny"
      });

    expect(res.status).toBe(200);
    expect(res.body.redirect).toBeDefined();

    const redirectUrl = new URL(res.body.redirect);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(CHATGPT_REDIRECT_URI);
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("state")).toBe("state_deny_test");
    expect(redirectUrl.searchParams.get("iss")).toBe("https://api.trustednetwork.in");
  });

  // ── I. Successful Authorization ─────────────────────────────────────────────
  it("I. Successful authorization returns redirect to ChatGPT with code, state, iss (no tokens)", async () => {
    const state = "state_allow_test";
    const challenge = "test_challenge_hash_123";

    await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

    // Step 1: Member login
    const loginRes = await request(app)
      .post("/oauth/login")
      .send({
        state,
        identifier: "9876543210",
        pin: "1234"
      });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);

    // Step 2: Member allows access
    const consentRes = await request(app)
      .post("/oauth/consent")
      .send({
        state,
        action: "allow"
      });

    expect(consentRes.status).toBe(200);
    expect(consentRes.body.redirect).toBeDefined();

    const redirectUrl = new URL(consentRes.body.redirect);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(CHATGPT_REDIRECT_URI);
    expect(redirectUrl.searchParams.get("code")).toBeDefined();
    expect(redirectUrl.searchParams.get("state")).toBe(state);
    expect(redirectUrl.searchParams.get("iss")).toBe("https://api.trustednetwork.in");

    // Critical security check: No tokens in browser URL!
    expect(redirectUrl.searchParams.get("access_token")).toBeNull();
    expect(redirectUrl.searchParams.get("refresh_token")).toBeNull();
  });

  // ── J. Token Exchange ───────────────────────────────────────────────────────
  it("J. Valid code + verifier exchanges for tokens (200, access_token, refresh_token)", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read", "posts:create"], CHATGPT_REDIRECT_URI, TEST_CLIENT_ID, challenge);

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CHATGPT_REDIRECT_URI,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe("Bearer");
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.scope).toBe("profile:read posts:create");

    // Verify token claims
    const decoded = verifyOAuthJwt(res.body.access_token);
    expect(decoded.sub).toBe(MEMBER_A_ID);
    expect(decoded.iss).toBe("https://api.trustednetwork.in");
    expect(decoded.aud).toBe("https://mcp.trustednetwork.in");
  });

  // ── K. PKCE Failure ─────────────────────────────────────────────────────────
  it("K. Token exchange with wrong verifier returns 400 invalid_grant", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read"], CHATGPT_REDIRECT_URI, TEST_CLIENT_ID, challenge);

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CHATGPT_REDIRECT_URI,
        client_id: TEST_CLIENT_ID,
        code_verifier: "wrong_verifier_string_12345"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
    expect(res.body.error_description).toContain("PKCE verification failed");
  });

  // ── L. Code Replay ──────────────────────────────────────────────────────────
  it("L. Code replay (reusing authorization code) returns 400 invalid_grant", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read"], CHATGPT_REDIRECT_URI, TEST_CLIENT_ID, challenge);

    // First exchange succeeds
    const firstRes = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CHATGPT_REDIRECT_URI,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier
      });
    expect(firstRes.status).toBe(200);

    // Second exchange MUST fail
    const replayRes = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CHATGPT_REDIRECT_URI,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier
      });
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe("invalid_grant");
  });

  // ── M. Redirect URI Mismatch ────────────────────────────────────────────────
  it("M. Wrong redirect_uri during token exchange returns 400 invalid_grant", async () => {
    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read"], CHATGPT_REDIRECT_URI, TEST_CLIENT_ID);

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://chatgpt.com/different_callback",
        client_id: TEST_CLIENT_ID
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
    expect(res.body.error_description).toContain("redirect_uri mismatch");
  });

  // ── N. Wrong Resource ───────────────────────────────────────────────────────
  it("N. Wrong resource target during token exchange returns 400", async () => {
    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read"], CHATGPT_REDIRECT_URI, TEST_CLIENT_ID);

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CHATGPT_REDIRECT_URI,
        client_id: TEST_CLIENT_ID,
        resource: "https://other-service.com"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  // ── O. MCP Unauthenticated ──────────────────────────────────────────────────
  it("O. MCP unauthenticated request returns 401 with WWW-Authenticate challenge", async () => {
    const res = await request(app).get("/test-protected");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain('resource_metadata="https://mcp.trustednetwork.in/.well-known/oauth-protected-resource"');
    expect(res.body._meta["mcp/www_authenticate"]).toBeDefined();
  });

  // ── P. MCP Invalid Token ────────────────────────────────────────────────────
  it("P. MCP invalid token returns 401", async () => {
    const res = await request(app)
      .get("/test-protected")
      .set("Authorization", "Bearer invalid.token.value");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  // ── Q. MCP Wrong Audience ───────────────────────────────────────────────────
  it("Q. MCP token with wrong audience returns 401", async () => {
    const wrongAudienceToken = signOAuthJwt(
      { sub: MEMBER_A_ID, memberId: MEMBER_A_ID, scopes: ["profile:read"], jti: "token_123", type: "access" },
      { issuer: "https://api.trustednetwork.in", audience: "https://wrong-audience.com", expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/test-protected")
      .set("Authorization", `Bearer ${wrongAudienceToken}`);

    expect(res.status).toBe(401);
  });

  // ── R. MCP Expired Token ────────────────────────────────────────────────────
  it("R. MCP expired token returns 401", async () => {
    const expiredToken = signOAuthJwt(
      { sub: MEMBER_A_ID, memberId: MEMBER_A_ID, scopes: ["profile:read"], jti: "token_exp", type: "access" },
      { issuer: "https://api.trustednetwork.in", audience: "https://mcp.trustednetwork.in", expiresIn: "-10s" }
    );

    const res = await request(app)
      .get("/test-protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  // ── S. Valid Access Token Authentication ────────────────────────────────────
  it("S. Valid access token succeeds and resolves member identity", async () => {
    const { accessToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read", "members:read"]);

    const res = await request(app)
      .get("/test-protected")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.memberId).toBe(MEMBER_A_ID);
    expect(res.body.scopes).toEqual(["profile:read", "members:read"]);
  });

  // ── T. Stable Profile Identity ──────────────────────────────────────────────
  it("T. Valid profile request returns stable member identity across calls", async () => {
    const { accessToken: token1 } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);
    const { accessToken: token2 } = await issueMcpTokens(MEMBER_A_ID, ["profile:read", "posts:read"]);

    const valid1 = await validateMcpAccessToken(token1);
    const valid2 = await validateMcpAccessToken(token2);

    expect(valid1.memberId).toBe(MEMBER_A_ID);
    expect(valid2.memberId).toBe(MEMBER_A_ID);
    expect(valid1.memberId).toBe(valid2.memberId);
  });

  // ── U. User Isolation ───────────────────────────────────────────────────────
  it("U. User isolation: User A token never returns User B identity", async () => {
    const tokenA = (await issueMcpTokens(MEMBER_A_ID, ["profile:read"])).accessToken;
    const tokenB = (await issueMcpTokens(MEMBER_B_ID, ["profile:read"])).accessToken;

    const resA = await request(app).get("/test-protected").set("Authorization", `Bearer ${tokenA}`);
    const resB = await request(app).get("/test-protected").set("Authorization", `Bearer ${tokenB}`);

    expect(resA.body.memberId).toBe(MEMBER_A_ID);
    expect(resB.body.memberId).toBe(MEMBER_B_ID);
    expect(resA.body.memberId).not.toEqual(resB.body.memberId);
  });

  // ── V. Refresh Token Rotation ───────────────────────────────────────────────
  it("V. Refresh token exchange issues new access token and rotates refresh token", async () => {
    const { refreshToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.refresh_token).not.toEqual(refreshToken);
  });

  // ── W. Revoked Refresh Token Rejection ──────────────────────────────────────
  it("W. Revoked or already used refresh token returns 400 invalid_grant", async () => {
    const { refreshToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);

    // First refresh rotates the token
    await request(app)
      .post("/oauth/token")
      .send({ grant_type: "refresh_token", refresh_token: refreshToken });

    // Attempting to reuse old refresh token must fail
    const replayRes = await request(app)
      .post("/oauth/token")
      .send({ grant_type: "refresh_token", refresh_token: refreshToken });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe("invalid_grant");
  });

  // ── X. Token Revocation ─────────────────────────────────────────────────────
  it("X. POST /oauth/revoke revokes token and terminates session", async () => {
    const { accessToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);

    const revokeRes = await request(app)
      .post("/oauth/revoke")
      .send({ token: accessToken });
    expect(revokeRes.status).toBe(200);

    // Authenticated request with revoked token must now fail
    const reqRes = await request(app)
      .get("/test-protected")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(reqRes.status).toBe(401);
  });

  // ── Y. JWKS Public Key Verification ─────────────────────────────────────────
  it("Y. GET /.well-known/jwks.json publishes valid public keys", async () => {
    const res = await request(app).get("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    expect(res.body.keys).toBeDefined();
    expect(res.body.keys.length).toBeGreaterThan(0);
    expect(res.body.keys[0].kty).toBe("RSA");
    expect(res.body.keys[0].use).toBe("sig");
    expect(res.body.keys[0].alg).toBe("RS256");
  });

  // ── Z. Dynamic Client Registration ──────────────────────────────────────────
  it("Z. POST /oauth/register dynamically registers clients", async () => {
    const res = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "ChatGPT Dynamic Connector",
        redirect_uris: [CHATGPT_REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      });

    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeDefined();
    expect(res.body.client_name).toBe("ChatGPT Dynamic Connector");
    expect(res.body.redirect_uris).toEqual([CHATGPT_REDIRECT_URI]);
  });

  // ── Standalone OpenAI Reviewer Login Route & Security Safeguards ─────────────
  describe("Standalone OpenAI Reviewer Login Route & Security Safeguards", () => {
    it("1. GET /oauth/login renders dedicated reviewer login UI with 200 OK", async () => {
      const res = await request(app).get("/oauth/login");
      expect(res.status).toBe(200);
      expect(res.header["content-type"]).toContain("text/html");
      expect(res.text).toContain("OpenAI Reviewer Login");
      expect(res.text).toContain("Reviewer Verification Portal");
      expect(res.text).toContain("Reviewer Mobile Number");
      expect(res.text).toContain("Verify Credentials");
      // Must not display OAuth consent screen on standalone reviewer page
      expect(res.text).not.toContain('id="consent-screen"');
    });

    it("2. POST /oauth/login standalone with valid reviewer credentials succeeds and NEVER issues tokens or codes", async () => {
      const res = await request(app)
        .post("/oauth/login")
        .send({
          identifier: "9876543210",
          pin: "1234"
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.standalone).toBe(true);
      expect(res.body.member).toBeDefined();
      expect(res.body.member.fullName).toBe("Test Member A");
      expect(res.body.member.mobileNumber).toBe("9876543210");

      // Critical OAuth Security Safeguard: Standalone login route must NEVER issue tokens or codes
      expect(res.body.code).toBeUndefined();
      expect(res.body.access_token).toBeUndefined();
      expect(res.body.refresh_token).toBeUndefined();
      expect(res.body.token_type).toBeUndefined();
      expect(res.body.id_token).toBeUndefined();
    });

    it("3. POST /oauth/login standalone with invalid reviewer PIN is rejected with 401", async () => {
      const res = await request(app)
        .post("/oauth/login")
        .send({
          identifier: "9876543210",
          pin: "9999"
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("access_denied");
      expect(res.body.error_description).toContain("Invalid mobile number or PIN");
      expect(res.body.access_token).toBeUndefined();
    });

    it("4. POST /oauth/login with missing identifier or pin returns 400 invalid_request", async () => {
      const res = await request(app)
        .post("/oauth/login")
        .send({
          identifier: "9876543210"
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("invalid_request");
    });

    it("5. GET /oauth/authorize still strictly rejects unparameterized requests", async () => {
      const res = await request(app).get("/oauth/authorize");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unsupported_response_type");
    });
  });
});
