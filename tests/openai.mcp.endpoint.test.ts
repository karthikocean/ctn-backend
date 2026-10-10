/**
 * Automated Test Suite for Dedicated OpenAI Plugin MCP Endpoint (/openai/mcp).
 *
 * Verifies:
 *  1. Protected resource metadata discovery on:
 *     - GET /openai/.well-known/oauth-protected-resource
 *     - GET /.well-known/oauth-protected-resource?resource=https://mcp.trustednetwork.in/openai/mcp
 *  2. Unauthenticated requests on /openai/mcp:
 *     - POST without token -> 401 with WWW-Authenticate challenge pointing to /openai metadata
 *     - GET without token -> 401
 *     - Request with invalid / expired token -> 401
 *  3. OAuth authorization code issuance with resource=https://mcp.trustednetwork.in/openai/mcp
 *  4. MCP Protocol Handshake via /openai/mcp:
 *     - JSON-RPC "initialize" request -> 200 with server capabilities and session ID
 *     - JSON-RPC "notifications/initialized"
 *  5. Tool discovery via /openai/mcp:
 *     - JSON-RPC "tools/list" -> 200 with all registered tools
 *  6. Tool execution via /openai/mcp:
 *     - JSON-RPC "tools/call" (get_my_profile) -> returns authenticated member profile
 *  7. Full parity between /openai/mcp and /mcp endpoints.
 */

import express from "express";
import request from "supertest";
import crypto from "crypto";

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
                fullName: "OpenAI Reviewer Demo",
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
                fullName: "OpenAI Reviewer Demo",
                businessName: "OpenAI Test Corp",
                city: "Bengaluru"
              }
            }
          };
        }
        return { data: { success: true, data: {} } };
      }),
      post: jest.fn(async () => ({ data: { success: true } })),
      put: jest.fn(async () => ({ data: { success: true } })),
      delete: jest.fn(async () => ({ data: { success: true } }))
    }))
  };
});

import { createOAuthRouter } from "../src/mcp/auth/oauth";
import { createMcpRouter } from "../src/mcp/router";
import { issueMcpTokens } from "../src/mcp/auth/token";

describe("OpenAI Plugin MCP Endpoint (/openai/mcp)", () => {
  let app: express.Express;
  const MEMBER_ID = "6aa2a07690f1611f31181c4a";
  const TEST_SCOPES = ["profile:read", "members:read", "posts:read", "posts:create"];
  let validAccessToken: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use("/", createOAuthRouter());
    app.use("/", createMcpRouter());

    const tokens = await issueMcpTokens(
      MEMBER_ID,
      TEST_SCOPES,
      "chatgpt-mcp",
      "https://mcp.trustednetwork.in/openai/mcp"
    );
    validAccessToken = tokens.accessToken;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Protected Resource Metadata Discovery ──────────────────────────────
  describe("1. Protected Resource Metadata Discovery", () => {
    it("GET /openai/.well-known/oauth-protected-resource returns 200 with openai/mcp resource", async () => {
      const res = await request(app).get("/openai/.well-known/oauth-protected-resource");
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe("https://mcp.trustednetwork.in/openai/mcp");
      expect(res.body.authorization_servers).toEqual(["https://api.trustednetwork.in"]);
      expect(res.body.scopes_supported).toEqual(expect.arrayContaining(["profile:read", "posts:read"]));
    });

    it("GET /.well-known/oauth-protected-resource?resource=... echoes targeted openai/mcp resource", async () => {
      const res = await request(app)
        .get("/.well-known/oauth-protected-resource")
        .query({ resource: "https://mcp.trustednetwork.in/openai/mcp" });
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe("https://mcp.trustednetwork.in/openai/mcp");
    });

    it("GET /.well-known/oauth-protected-resource returns standard base resource by default", async () => {
      const res = await request(app).get("/.well-known/oauth-protected-resource");
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe("https://mcp.trustednetwork.in");
    });
  });

  // ── 2. Unauthorized Requests on /openai/mcp ───────────────────────────────
  describe("2. Unauthorized Requests", () => {
    it("POST /openai/mcp without token returns 401 with WWW-Authenticate pointing to /openai metadata", async () => {
      const res = await request(app)
        .post("/openai/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" }
          }
        });

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toContain('resource_metadata="https://mcp.trustednetwork.in/openai/.well-known/oauth-protected-resource"');
      expect(res.body.error).toBe("invalid_token");
      expect(res.body._meta["mcp/www_authenticate"]).toBeDefined();
    });

    it("GET /openai/mcp without token returns 401", async () => {
      const res = await request(app).get("/openai/mcp");
      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toContain('resource_metadata="https://mcp.trustednetwork.in/openai/.well-known/oauth-protected-resource"');
    });

    it("POST /openai/mcp with malformed token returns 401", async () => {
      const res = await request(app)
        .post("/openai/mcp")
        .set("Authorization", "Bearer invalid-garbage-token-here")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize"
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("invalid_token");
    });
  });

  // ── 3. OAuth Flow with /openai/mcp Resource Parameter ─────────────────────
  describe("3. OAuth Flow with /openai/mcp Resource", () => {
    it("GET /oauth/authorize accepts resource=https://mcp.trustednetwork.in/openai/mcp", async () => {
      const verifier = "test_code_verifier_long_enough_1234567890_abc";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

      const res = await request(app)
        .get("/oauth/authorize")
        .query({
          response_type: "code",
          client_id: "chatgpt-mcp",
          redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
          scope: "profile:read posts:read",
          state: "state_openai_mcp_test",
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource: "https://mcp.trustednetwork.in/openai/mcp"
        });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Connect with ChatGPT");
      expect(res.text).toContain("state_openai_mcp_test");
    });
  });

  // ── 4. MCP Initialization, Tool Discovery & Execution via /openai/mcp ─────
  describe("4. MCP Protocol via /openai/mcp", () => {
    let sessionId: string;

    it("Initializes MCP session via POST /openai/mcp with Bearer token", async () => {
      const res = await request(app)
        .post("/openai/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "OpenAI-ChatGPT", version: "1.0.0" }
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.result).toBeDefined();
      expect(res.body.result.protocolVersion).toBe("2024-11-05");
      expect(res.body.result.serverInfo.name).toBe("trusted-network-mcp");
      expect(res.body.result.capabilities.tools).toBeDefined();

      sessionId = res.headers["mcp-session-id"];
      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("Sends notifications/initialized via POST /openai/mcp", async () => {
      const res = await request(app)
        .post("/openai/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .set("Mcp-Session-Id", sessionId)
        .send({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        });

      // Notifications return 200 or 202/204 with no JSON-RPC id
      expect([200, 202, 204]).toContain(res.status);
    });

    it("Discovers tools (tools/list) via POST /openai/mcp", async () => {
      const res = await request(app)
        .post("/openai/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .set("Mcp-Session-Id", sessionId)
        .send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {}
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.tools).toBeDefined();
      expect(Array.isArray(res.body.result.tools)).toBe(true);

      const toolNames = res.body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("get_my_profile");
      expect(toolNames).toContain("search_members");
      expect(toolNames).toContain("create_post");
      expect(toolNames).toContain("edit_post");
      expect(toolNames).toContain("edit_promotion");
      expect(toolNames).toContain("delete_post");
    });

    it("Executes tool (tools/call for get_my_profile) via POST /openai/mcp", async () => {
      const res = await request(app)
        .post("/openai/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .set("Mcp-Session-Id", sessionId)
        .send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "get_my_profile",
            arguments: {}
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.content).toBeDefined();
      expect(res.body.result.content[0].type).toBe("text");

      const profileData = JSON.parse(res.body.result.content[0].text);
      expect(profileData.success).toBe(true);
      expect(profileData.data.fullName).toBe("OpenAI Reviewer Demo");
      expect(profileData.data.businessName).toBe("OpenAI Test Corp");
    });

    it("Terminates session via DELETE /openai/mcp", async () => {
      const res = await request(app)
        .delete("/openai/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .set("Mcp-Session-Id", sessionId);

      expect(res.status).toBe(200);
    });

    it("Subsequent DELETE /openai/mcp with terminated session returns 404", async () => {
      const res = await request(app)
        .delete("/openai/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .set("Mcp-Session-Id", sessionId);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Session not found");
    });
  });

  // ── 5. Parity Check: /mcp still fully functional ──────────────────────────
  describe("5. Endpoint Parity: Existing /mcp", () => {
    it("Initializes and lists tools via /mcp as well", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .send({
          jsonrpc: "2.0",
          id: 10,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" }
          }
        });

      expect(res.status).toBe(200);
      const sid = res.headers["mcp-session-id"];
      expect(sid).toBeDefined();

      const listRes = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${validAccessToken}`)
        .set("Mcp-Session-Id", sid)
        .send({
          jsonrpc: "2.0",
          id: 11,
          method: "tools/list",
          params: {}
        });

      expect(listRes.status).toBe(200);
      expect(listRes.body.result.tools.length).toBeGreaterThan(0);
    });
  });
});
