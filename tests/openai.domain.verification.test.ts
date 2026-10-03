/**
 * Automated tests for OpenAI Domain Verification Support on MCP Server
 *
 * Requirements tested:
 *   A. Valid token:
 *      - Returns HTTP 200, Content-Type: text/plain
 *      - Response body exactly equals the token (no JSON, no HTML, no quotes)
 *   B. Missing/Empty token:
 *      - Returns HTTP 500
 *      - Token is never exposed
 *      - Logs server-side configuration error
 *   C. Root path verification:
 *      - Endpoint is available at root: /.well-known/openai-apps-challenge
 *      - Is NOT mounted under /mcp/.well-known/openai-apps-challenge
 *   D. Existing MCP endpoint integrity:
 *      - Verifies /mcp endpoint still behaves identically (401 with standard WWW-Authenticate)
 *      - Does not break existing MCP protocol functionality
 */

import express from "express";
import request from "supertest";

// Mock Redis
const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  on: jest.fn(),
  status: "ready",
  quit: jest.fn(),
  disconnect: jest.fn(),
  call: jest.fn()
};

jest.mock("../src/config/appRedis", () => ({
  appRedis: redisMock,
  appRedisConfig: {},
  checkRedisHealth: jest.fn()
}));

// Mock Logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

jest.mock("../src/utils/logger", () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger
}));

// Set required test env vars
process.env.MCP_OAUTH_TOKEN_SECRET = "test_mcp_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
process.env.MCP_OAUTH_ISSUER = "https://api.trustednetwork.in";
process.env.MCP_OAUTH_AUDIENCE = "https://mcp.trustednetwork.in";
process.env.MCP_PUBLIC_URL = "https://mcp.trustednetwork.in";
process.env.JWT_SECRET = "test_jwt_secret";

import { createOAuthRouter } from "../src/mcp/auth/oauth";
import { mcpAuthMiddleware } from "../src/mcp/middleware/authentication";

describe("OpenAI Domain Verification (.well-known/openai-apps-challenge)", () => {
  let app: express.Express;
  const originalToken = process.env.OPENAI_APPS_CHALLENGE_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mount OAuth router at root / as in production src/mcp/index.ts and src/index.ts
    app.use("/", createOAuthRouter());

    // Mount /mcp with mcpAuthMiddleware as in production
    app.all("/mcp", mcpAuthMiddleware, (_req, res) => {
      res.status(200).json({ status: "mcp-ready" });
    });
  });

  afterAll(() => {
    if (originalToken !== undefined) {
      process.env.OPENAI_APPS_CHALLENGE_TOKEN = originalToken;
    } else {
      delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    }
  });

  describe("Requirement A: Valid Token", () => {
    const TEST_TOKEN = "openai-apps-challenge-token-abc123xyz789";

    beforeEach(() => {
      process.env.OPENAI_APPS_CHALLENGE_TOKEN = TEST_TOKEN;
    });

    it("should return HTTP 200 with Content-Type text/plain", async () => {
      const res = await request(app).get("/.well-known/openai-apps-challenge");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
    });

    it("should return the exact token in response body without JSON, HTML, or quotes", async () => {
      const res = await request(app).get("/.well-known/openai-apps-challenge");

      expect(res.text).toBe(TEST_TOKEN);
      expect(res.text.startsWith("{")).toBe(false);
      expect(res.text.startsWith('"')).toBe(false);
      expect(res.text.includes("<html")).toBe(false);
    });

    it("should trim surrounding whitespace from the token", async () => {
      process.env.OPENAI_APPS_CHALLENGE_TOKEN = `  ${TEST_TOKEN} \n`;
      const res = await request(app).get("/.well-known/openai-apps-challenge");

      expect(res.status).toBe(200);
      expect(res.text).toBe(TEST_TOKEN);
    });
  });

  describe("Requirement B: Missing or Empty Token", () => {
    it("should return HTTP 500 when OPENAI_APPS_CHALLENGE_TOKEN is unset", async () => {
      delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;

      const res = await request(app).get("/.well-known/openai-apps-challenge");

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(res.text).toContain("OpenAI domain verification token is not configured");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should return HTTP 500 when OPENAI_APPS_CHALLENGE_TOKEN is empty string", async () => {
      process.env.OPENAI_APPS_CHALLENGE_TOKEN = "   ";

      const res = await request(app).get("/.well-known/openai-apps-challenge");

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("Requirement C: Path & Mounting Integrity", () => {
    beforeEach(() => {
      process.env.OPENAI_APPS_CHALLENGE_TOKEN = "sample-token-12345";
    });

    it("should be accessible at root: /.well-known/openai-apps-challenge", async () => {
      const res = await request(app).get("/.well-known/openai-apps-challenge");
      expect(res.status).toBe(200);
      expect(res.text).toBe("sample-token-12345");
    });

    it("should NOT be mounted under /mcp/.well-known/openai-apps-challenge", async () => {
      const res = await request(app).get("/mcp/.well-known/openai-apps-challenge");
      // /mcp requires auth or returns 404 for unknown sub-route
      expect(res.status).not.toBe(200);
    });
  });

  describe("Requirement D: Existing MCP Endpoint Preservation", () => {
    it("should continue returning 401 with standard WWW-Authenticate challenge on unauthenticated /mcp GET", async () => {
      const res = await request(app).get("/mcp");

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toBeDefined();
      expect(res.body.error).toBe("invalid_token");
      expect(res.body._meta?.["mcp/www_authenticate"]).toBeDefined();
    });

    it("should continue returning 401 with standard WWW-Authenticate challenge on unauthenticated /mcp POST", async () => {
      const res = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toBeDefined();
      expect(res.body.error).toBe("invalid_token");
    });
  });
});
