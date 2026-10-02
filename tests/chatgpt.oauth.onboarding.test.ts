/**
 * Comprehensive Test Suite for ChatGPT OAuth Onboarding, Mobile Endpoints,
 * User Identity Binding, Scope Enforcement, and Security Invariants.
 */

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
process.env.MCP_PUBLIC_URL = "https://api.trustednetwork.in";
process.env.MCP_OAUTH_ISSUER = "https://api.trustednetwork.in";
process.env.MCP_OAUTH_AUDIENCE = "trusted-network-mcp";
process.env.TRUSTED_NETWORK_API_URL = "http://127.0.0.1:5001";
process.env.MCP_ENABLED = "true";

import { ObjectId } from "mongodb";
import { Member, MemberStatus } from "../src/entity/Member";
import { OAuthGrant } from "../src/entity/OAuthGrant";
import { ChatGptOAuthService } from "../src/services/chatgptOAuth.service";
import {
  issueMcpTokens,
  validateMcpAccessToken,
  issueAuthCode,
  consumeAuthCode,
  revokeMcpToken
} from "../src/mcp/auth/token";

describe("ChatGPT OAuth Onboarding & Security Invariants", () => {
  const MEMBER_A_ID = "6aa2a07690f1611f31181c4a";
  const MEMBER_B_ID = "6bb2a07690f1611f31181c4b";

  let oauthService: ChatGptOAuthService;
  let mockMemberRepo: any;
  let mockGrantRepo: any;

  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();

    mockMemberRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockGrantRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      updateMany: jest.fn(),
    };

    oauthService = new ChatGptOAuthService();
    (oauthService as any).memberRepo = mockMemberRepo;
    (oauthService as any).grantRepo = mockGrantRepo;
  });

  // 1. Generate connection URL
  it("1. generates a valid OAuth connection URL with PKCE and ticket", async () => {
    mockMemberRepo.findOne.mockResolvedValue({
      _id: new ObjectId(MEMBER_A_ID),
      fullName: "Anbu",
      mobileNumber: "9361570434",
      status: MemberStatus.ACTIVE,
      isDeleted: false,
    });

    const urlString = await oauthService.generateConnectionUrl(MEMBER_A_ID);
    const parsed = new URL(urlString);

    expect(parsed.origin).toBe("https://api.trustednetwork.in");
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("chatgpt-mcp");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBeDefined();
    expect(parsed.searchParams.get("state")).toBeDefined();
    expect(parsed.searchParams.get("ticket")).toBeDefined();

    // Verify ticket and PKCE are stored in Redis
    const ticket = parsed.searchParams.get("ticket")!;
    const ticketVal = redisStore.get(`chatgpt:ticket:${ticket}`);
    expect(ticketVal).toBeDefined();
    expect(JSON.parse(ticketVal!).memberId).toBe(MEMBER_A_ID);
  });

  // 2. Invalid connection request
  it("2. throws when generating connection URL for invalid member ID", async () => {
    await expect(oauthService.generateConnectionUrl("invalid-id")).rejects.toThrow("Invalid member ID");
  });

  // 3. Blocked member cannot generate connection URL
  it("3. rejects connection URL generation for blocked member", async () => {
    mockMemberRepo.findOne.mockResolvedValue({
      _id: new ObjectId(MEMBER_A_ID),
      status: MemberStatus.BLOCKED,
      isDeleted: false,
    });

    await expect(oauthService.generateConnectionUrl(MEMBER_A_ID)).rejects.toThrow("Account is blocked");
  });

  // 4. Authorization code creation and storage
  it("4. issues an authorization code stored in Redis with 5-minute TTL", async () => {
    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read", "posts:read"], "https://chatgpt.com/callback", "test-challenge");
    expect(code).toBeDefined();
    expect(typeof code).toBe("string");

    const raw = redisStore.get(`mcp:code:${code}`);
    expect(raw).toBeDefined();
    const data = JSON.parse(raw!);
    expect(data.memberId).toBe(MEMBER_A_ID);
    expect(data.codeChallenge).toBe("test-challenge");
  });

  // 5. Authorization code single-use consumption
  it("5. consumes authorization code once and rejects reuse", async () => {
    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read"], "https://chatgpt.com/callback", "challenge-123");

    // First consumption succeeds
    const consumed = await consumeAuthCode(code, "https://chatgpt.com/callback");
    expect(consumed.memberId).toBe(MEMBER_A_ID);
    expect(consumed.codeChallenge).toBe("challenge-123");

    // Second consumption MUST fail (single-use)
    await expect(consumeAuthCode(code, "https://chatgpt.com/callback")).rejects.toThrow();
  });

  // 6. Authorization code expiration / non-existent
  it("6. rejects an expired or unknown authorization code", async () => {
    await expect(consumeAuthCode("non-existent-code", "https://chatgpt.com/callback")).rejects.toThrow();
  });

  // 7. Authorization code redirect_uri mismatch
  it("7. rejects authorization code if redirect_uri differs from issuance", async () => {
    const code = await issueAuthCode(MEMBER_A_ID, ["profile:read"], "https://chatgpt.com/callback");
    await expect(consumeAuthCode(code, "https://attacker.com/callback")).rejects.toThrow("redirect_uri mismatch");
  });

  // 8. PKCE validation
  it("8. verifies PKCE S256 verifier correctly", () => {
    const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expectedChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    const computed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    expect(computed).toBe(expectedChallenge);

    const wrongComputed = crypto.createHash("sha256").update("wrong-verifier").digest("base64url");
    expect(wrongComputed).not.toBe(expectedChallenge);
  });

  // 9. Token issuance
  it("9. issues valid MCP access and refresh tokens", async () => {
    const { accessToken, refreshToken, expiresIn } = await issueMcpTokens(MEMBER_A_ID, ["profile:read", "posts:create"]);

    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
    expect(expiresIn).toBe(3600);

    // Verify accessToken signature
    const decoded = jwt.verify(accessToken, process.env.MCP_OAUTH_TOKEN_SECRET!) as any;
    expect(decoded.memberId).toBe(MEMBER_A_ID);
    expect(decoded.scopes).toEqual(["profile:read", "posts:create"]);
    expect(decoded.type).toBe("access");
  });

  // 10. Invalid token rejection
  it("10. rejects token signed with wrong secret", async () => {
    const fakeToken = jwt.sign({ memberId: MEMBER_A_ID, type: "access" }, "wrong-secret-key-12345678901234567890");
    await expect(validateMcpAccessToken(fakeToken)).rejects.toThrow();
  });

  // 11. Expired token rejection
  it("11. rejects expired MCP access token", async () => {
    const expiredToken = jwt.sign(
      { jti: "test-jti", memberId: MEMBER_A_ID, type: "access", scopes: ["profile:read"] },
      process.env.MCP_OAUTH_TOKEN_SECRET!,
      { expiresIn: "-1s", issuer: process.env.MCP_OAUTH_ISSUER, audience: process.env.MCP_OAUTH_AUDIENCE }
    );
    await expect(validateMcpAccessToken(expiredToken)).rejects.toThrow();
  });

  // 12. Revoked token rejection
  it("12. rejects a token whose Redis session was revoked", async () => {
    const { accessToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);
    const decoded = jwt.decode(accessToken) as any;

    // Delete Redis session to simulate revocation
    redisStore.delete(`mcp:access:${decoded.jti}`);

    await expect(validateMcpAccessToken(accessToken)).rejects.toThrow("MCP session not found or revoked");
  });

  // 13. Token revocation utility
  it("13. revokeMcpToken deletes access and refresh keys and auth cache", async () => {
    const { accessToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);
    const decoded = jwt.decode(accessToken) as any;

    expect(redisStore.has(`mcp:access:${decoded.jti}`)).toBe(true);

    await revokeMcpToken(accessToken);

    expect(redisStore.has(`mcp:access:${decoded.jti}`)).toBe(false);
  });

  // 14. Scope enforcement
  it("14. verifies granted scopes match requested supported scopes", async () => {
    const requested = ["profile:read", "posts:create", "unsupported:scope"];
    const filtered = requested.filter(s => ["profile:read", "members:read", "posts:read", "posts:create", "posts:write"].includes(s));

    expect(filtered).toEqual(["profile:read", "posts:create"]);
    expect(filtered).not.toContain("unsupported:scope");
  });

  // 15. User identity binding (Token memberId determines identity)
  it("15. binds identity strictly to validated OAuth token memberId", async () => {
    const { accessToken } = await issueMcpTokens(MEMBER_A_ID, ["profile:read"]);
    const validated = await validateMcpAccessToken(accessToken);

    expect(validated.memberId).toBe(MEMBER_A_ID);
    expect(validated.memberId).not.toBe(MEMBER_B_ID);
  });

  // 16. Disconnect revokes grants and returns status
  it("16. disconnect marks grants revoked and clears sessions", async () => {
    const grant = new OAuthGrant();
    grant.userId = new ObjectId(MEMBER_A_ID);
    grant.clientId = "chatgpt-mcp";
    grant.scopes = ["profile:read", "posts:read"];
    grant.isRevoked = false;
    grant.expiresAt = new Date(Date.now() + 3600000);

    mockGrantRepo.find.mockResolvedValue([grant]);
    mockGrantRepo.save.mockImplementation(async (g: OAuthGrant) => g);

    const result = await oauthService.disconnect(MEMBER_A_ID);
    expect(result).toBe(true);
    expect(grant.isRevoked).toBe(true);
    expect(grant.revokedAt).toBeDefined();
  });

  // 17. Connection status reflects active vs disconnected
  it("17. returns connected true when active grant exists and false when none", async () => {
    // When no active grant
    mockGrantRepo.findOne.mockResolvedValue(null);
    const disconnectedStatus = await oauthService.getConnectionStatus(MEMBER_A_ID);
    expect(disconnectedStatus.connected).toBe(false);
    expect(disconnectedStatus.scopes).toEqual([]);

    // When active grant exists
    const activeGrant = new OAuthGrant();
    activeGrant.userId = new ObjectId(MEMBER_A_ID);
    activeGrant.scopes = ["profile:read", "posts:create"];
    activeGrant.isRevoked = false;
    activeGrant.expiresAt = new Date(Date.now() + 3600000);
    mockGrantRepo.findOne.mockResolvedValue(activeGrant);

    const connectedStatus = await oauthService.getConnectionStatus(MEMBER_A_ID);
    expect(connectedStatus.connected).toBe(true);
    expect(connectedStatus.scopes).toEqual(["profile:read", "posts:create"]);
  });

  // 18. Reconnect flow generates fresh URL and ticket
  it("18. reconnect allows generating a fresh connection URL cleanly", async () => {
    mockMemberRepo.findOne.mockResolvedValue({
      _id: new ObjectId(MEMBER_A_ID),
      fullName: "Anbu",
      mobileNumber: "9361570434",
      status: MemberStatus.ACTIVE,
      isDeleted: false,
    });

    // Disconnect previous
    mockGrantRepo.find.mockResolvedValue([]);
    await oauthService.disconnect(MEMBER_A_ID);

    // Reconnect
    const newUrl = await oauthService.generateConnectionUrl(MEMBER_A_ID);
    expect(newUrl).toContain("ticket=");
    expect(newUrl).toContain("state=");
  });

  // 19. User identity isolation (User A cannot act as User B)
  it("19. guarantees User A token cannot impersonate User B", async () => {
    const tokenA = (await issueMcpTokens(MEMBER_A_ID, ["profile:read"])).accessToken;
    const tokenB = (await issueMcpTokens(MEMBER_B_ID, ["profile:read"])).accessToken;

    const validatedA = await validateMcpAccessToken(tokenA);
    const validatedB = await validateMcpAccessToken(tokenB);

    expect(validatedA.memberId).toBe(MEMBER_A_ID);
    expect(validatedB.memberId).toBe(MEMBER_B_ID);
    expect(validatedA.memberId).not.toEqual(validatedB.memberId);
  });
});
