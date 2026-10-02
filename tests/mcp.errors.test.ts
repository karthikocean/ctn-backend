/**
 * MCP Error Utilities Tests
 *
 * Tests for the safe error mapping layer that prevents internal error details
 * from leaking to ChatGPT.
 *
 * Covers:
 *   - toMcpError: maps HTTP status codes to safe McpToolError types
 *   - errorResponse: formats errors for MCP tool return
 *   - McpToolError hierarchy
 */

jest.mock("../src/config/appRedis", () => ({
  appRedis: { on: jest.fn(), status: "ready" },
  appRedisConfig: {},
  checkRedisHealth: jest.fn(),
}));

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

process.env.JWT_SECRET = "test_jwt_secret";
process.env.MCP_OAUTH_TOKEN_SECRET = "test_mcp_secret_x64";

import {
  McpToolError,
  McpAuthError,
  McpValidationError,
  McpNotFoundError,
  McpPermissionError,
  McpRateLimitError,
  toMcpError,
  errorResponse,
} from "../src/mcp/utils/errors";

// ─────────────────────────────────────────────────────────────────────────────
describe("MCP Error Utilities", () => {

  // ── Error class hierarchy ──────────────────────────────────────────────────
  describe("McpToolError hierarchy", () => {
    it("McpToolError has code and message", () => {
      const err = new McpToolError("Something failed", "MY_CODE");
      expect(err.message).toBe("Something failed");
      expect(err.code).toBe("MY_CODE");
      expect(err instanceof Error).toBe(true);
    });

    it("McpAuthError has code AUTH_ERROR", () => {
      const err = new McpAuthError();
      expect(err.code).toBe("AUTH_ERROR");
      expect(err.message).toBe("Authentication failed");
    });

    it("McpAuthError accepts custom message", () => {
      const err = new McpAuthError("Session expired");
      expect(err.message).toBe("Session expired");
    });

    it("McpValidationError has code VALIDATION_ERROR", () => {
      const err = new McpValidationError("title is required");
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toBe("title is required");
    });

    it("McpNotFoundError has code NOT_FOUND", () => {
      const err = new McpNotFoundError("Post");
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toBe("Post not found");
    });

    it("McpPermissionError has code PERMISSION_DENIED", () => {
      const err = new McpPermissionError();
      expect(err.code).toBe("PERMISSION_DENIED");
    });

    it("McpRateLimitError has code RATE_LIMIT", () => {
      const err = new McpRateLimitError();
      expect(err.code).toBe("RATE_LIMIT");
    });
  });

  // ── toMcpError: HTTP status mapping ───────────────────────────────────────
  describe("toMcpError — HTTP status mapping", () => {
    function makeAxiosError(status: number, message: string) {
      return {
        response: { status, data: { message } },
        message,
      };
    }

    it("maps HTTP 401 to McpAuthError", () => {
      const err = toMcpError(makeAxiosError(401, "Unauthorized"), "test");
      expect(err).toBeInstanceOf(McpAuthError);
      expect(err.code).toBe("AUTH_ERROR");
    });

    it("maps HTTP 405 (session expired) to McpAuthError", () => {
      const err = toMcpError(makeAxiosError(405, "Session expired"), "test");
      expect(err).toBeInstanceOf(McpAuthError);
      expect(err.code).toBe("AUTH_ERROR");
    });

    it("maps HTTP 403 to McpPermissionError", () => {
      const err = toMcpError(makeAxiosError(403, "Forbidden"), "test");
      expect(err).toBeInstanceOf(McpPermissionError);
      expect(err.code).toBe("PERMISSION_DENIED");
    });

    it("maps HTTP 404 to McpNotFoundError", () => {
      const err = toMcpError(makeAxiosError(404, "Post not found"), "test");
      expect(err).toBeInstanceOf(McpNotFoundError);
      expect(err.code).toBe("NOT_FOUND");
    });

    it("maps HTTP 400 to McpValidationError with backend message", () => {
      const backendMessage = "title is required";
      const err = toMcpError(makeAxiosError(400, backendMessage), "test");
      expect(err).toBeInstanceOf(McpValidationError);
      expect(err.code).toBe("VALIDATION_ERROR");
      // The backend's 400 message is safe to return (it's user-facing validation)
      expect(err.message).toBe(backendMessage);
    });

    it("maps HTTP 429 to McpRateLimitError", () => {
      const err = toMcpError(makeAxiosError(429, "Rate limited"), "test");
      expect(err).toBeInstanceOf(McpRateLimitError);
      expect(err.code).toBe("RATE_LIMIT");
    });

    it("maps HTTP 500 to generic McpToolError (no internal details leaked)", () => {
      const err = toMcpError(makeAxiosError(500, "Internal server error: MongoError: connection refused"), "test");
      expect(err).toBeInstanceOf(McpToolError);
      // CRITICAL: 500 message must NOT contain the internal details
      expect(err.message).not.toContain("MongoError");
      expect(err.message).not.toContain("connection refused");
      expect(err.message).toMatch(/error occurred/i);
    });

    it("maps unknown errors to generic message (no stack trace leaked)", () => {
      const weirdError = new Error("Something very internal happened");
      weirdError.stack = "Error: Something very internal happened\n  at /src/db/connection.ts:42";
      const err = toMcpError(weirdError, "test");
      expect(err.message).not.toContain("/src/db");
      expect(err.message).not.toContain("connection.ts");
    });

    it("CRITICAL: does not expose internal Mongo or stack trace details on 5xx", () => {
      const internalError = {
        response: {
          status: 503,
          data: { message: "MongoServerError: cannot find ns [CTN_Dev.members]" },
        },
        message: "Request failed",
      };

      const err = toMcpError(internalError, "test");
      // Must never expose Mongo collection names, database names, or namespaces
      expect(err.message).not.toContain("MongoServerError");
      expect(err.message).not.toContain("CTN_Dev");
      expect(err.message).not.toContain("members");
    });
  });

  // ── errorResponse ──────────────────────────────────────────────────────────
  describe("errorResponse", () => {
    it("formats error as MCP content with isError=true", () => {
      const err = new McpValidationError("Post type is required");
      const response = errorResponse(err);

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe("text");

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe("VALIDATION_ERROR");
      expect(parsed.message).toBe("Post type is required");
    });

    it("formats McpAuthError correctly", () => {
      const err = new McpAuthError("Session expired or unauthorized. Please reconnect.");
      const response = errorResponse(err);

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("AUTH_ERROR");
      expect(parsed.success).toBe(false);
    });

    it("formatted response is valid JSON", () => {
      const err = new McpToolError('Special chars: <script>alert("xss")</script>', "XSS_TEST");
      const response = errorResponse(err);

      expect(() => JSON.parse(response.content[0].text)).not.toThrow();
    });
  });
});
