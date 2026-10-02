/**
 * MCP-specific error utilities.
 *
 * Rules:
 *  - Never expose internal error messages, stack traces, or DB details to ChatGPT.
 *  - Map HTTP status codes from the backend to MCP-friendly error strings.
 *  - Log the original error internally for debugging.
 */

import logger from "../../utils/logger";

const CTX = "MCPError";

export class McpToolError extends Error {
  public readonly code: string;

  constructor(message: string, code = "TOOL_ERROR") {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export class McpAuthError extends McpToolError {
  constructor(message = "Authentication failed") {
    super(message, "AUTH_ERROR");
    this.name = "McpAuthError";
  }
}

export class McpValidationError extends McpToolError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "McpValidationError";
  }
}

export class McpNotFoundError extends McpToolError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, "NOT_FOUND");
    this.name = "McpNotFoundError";
  }
}

export class McpPermissionError extends McpToolError {
  constructor(message = "Permission denied") {
    super(message, "PERMISSION_DENIED");
    this.name = "McpPermissionError";
  }
}

export class McpRateLimitError extends McpToolError {
  constructor() {
    super("Rate limit exceeded. Please try again later.", "RATE_LIMIT");
    this.name = "McpRateLimitError";
  }
}

/**
 * Converts an HTTP error from the backend API into a safe MCP error.
 * Internal error details are logged but never returned to ChatGPT.
 */
export function toMcpError(error: any, context?: string): McpToolError {
  const status = error?.response?.status || error?.status || 0;
  const backendMessage: string = error?.response?.data?.message || error?.message || "Unknown error";

  logger.error(
    `[MCP] Backend error${context ? ` in ${context}` : ""}: ${backendMessage} (HTTP ${status})`,
    error instanceof Error ? error : new Error(String(error)),
    CTX
  );

  if (status === 401 || status === 405) {
    return new McpAuthError("Session expired or unauthorized. Please reconnect.");
  }
  if (status === 403) {
    return new McpPermissionError("You do not have permission to perform this action.");
  }
  if (status === 404) {
    return new McpNotFoundError();
  }
  if (status === 400) {
    // Pass through validation messages from the backend — they are user-facing
    return new McpValidationError(backendMessage);
  }
  if (status === 429) {
    return new McpRateLimitError();
  }

  // 5xx or unexpected: return generic message
  return new McpToolError("An error occurred while processing your request. Please try again.");
}

/**
 * Formats a McpToolError for return from an MCP tool handler.
 */
export function errorResponse(error: McpToolError) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: error.code,
          message: error.message
        }, null, 2)
      }
    ],
    isError: true
  };
}
