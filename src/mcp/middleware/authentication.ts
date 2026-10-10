
/**
 * MCP Authentication Middleware.
 *
 * Validates OAuth 2.1 Bearer tokens on MCP requests.
 * Resolves memberId and scopes strictly from the validated token.
 *
 * Preserves existing /mcp and /openai/mcp behavior while
 * supporting /trusted-network/mcp.
 */

import { Request, Response, NextFunction } from "express";
import { validateMcpAccessToken } from "../auth/token";
import { mcpConfig } from "../config";
import logger from "../../utils/logger";

const CTX = "MCPAuthMiddleware";

export interface McpRequestContext {
  memberId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      mcpContext?: McpRequestContext;
    }
  }
}

/**
 * Resolve the RFC 9728 protected-resource metadata URL for an endpoint.
 *
 * This supports both RFC-style metadata paths and the existing
 * OpenAI metadata alias.
 */
export function getProtectedResourceMetadataUrl(req?: Request): string {
  const base = mcpConfig.publicUrl.replace(/\/+$/, "");

  const path = (
    req?.originalUrl?.split("?")[0] ||
    req?.path ||
    ""
  ).replace(/\/+$/, "");

  const basePath = (req?.baseUrl || "").replace(/\/+$/, "");
  const endpoint = `${basePath}${path}`.replace(/\/+/g, "/");

  if (
    endpoint.endsWith("/trusted-network/mcp") ||
    endpoint.includes("/trusted-network/mcp/")
  ) {
    return `${base}/.well-known/oauth-protected-resource/trusted-network/mcp`;
  }

  if (
    endpoint.endsWith("/openai/mcp") ||
    endpoint.includes("/openai/mcp/")
  ) {
    return `${base}/openai/.well-known/oauth-protected-resource`;
  }

  if (endpoint.endsWith("/mcp") || endpoint.includes("/mcp/")) {
    return `${base}/.well-known/oauth-protected-resource/mcp`;
  }

  // Backwards-compatible fallback for existing callers.
  return `${base}/.well-known/oauth-protected-resource`;
}

function safeSetHeader(
  res: Response,
  header: string,
  value: string
): void {
  try {
    res.setHeader(header, value);
  } catch {
    // Header-setting failure must not expose token details.
  }
}

function sendUnauthorized(
  res: Response,
  metadataUrl: string,
  description: string,
  challengeDescription: string,
  includeInvalidToken = false
): void {
  const challenge = [
    `Bearer resource_metadata="${metadataUrl}"`,
    includeInvalidToken ? "error=\"invalid_token\"" : undefined,
    `error_description="${challengeDescription}"`
  ].filter(Boolean).join(", ");

  safeSetHeader(res, "WWW-Authenticate", challenge);

  res.status(401).json({
    error: "invalid_token",
    error_description: description,
    _meta: {
      "mcp/www_authenticate": [challenge]
    }
  });
}

export async function mcpAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const resourceMetadataUrl = getProtectedResourceMetadataUrl(req);
  const authHeader = req.headers.authorization;

  if (!authHeader || !/^Bearer\s/i.test(authHeader)) {
    sendUnauthorized(
      res,
      resourceMetadataUrl,
      "Bearer token required",
      "Authentication required"
    );
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    sendUnauthorized(
      res,
      resourceMetadataUrl,
      "Token missing",
      "Token missing",
      true
    );
    return;
  }

  try {
    const { memberId, scopes } = await validateMcpAccessToken(token);

    if (!memberId || !Array.isArray(scopes)) {
      throw new Error("Validated token has invalid identity or scopes");
    }

    // Identity comes from the validated token, never tool arguments.
    req.mcpContext = { memberId, scopes };

    next();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown token validation error";

    // Do not log the token or authorization header.
    logger.warn(`MCP auth verification failed: ${message}`, CTX);

    sendUnauthorized(
      res,
      resourceMetadataUrl,
      "Token is invalid, expired, or revoked",
      "Token is invalid or expired",
      true
    );
  }
}
