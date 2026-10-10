/**
 * MCP Authentication Middleware.
 *
 * Validates the OAuth 2.1 Bearer token on every MCP request.
 * Resolves memberId and scopes strictly from the validated token.
 *
 * Returns 401 with standard WWW-Authenticate challenge pointing to
 * the protected resource metadata URL (Step 15 & 16).
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

export function getProtectedResourceMetadataUrl(req?: Request): string {
  const base = mcpConfig.publicUrl.replace(/\/+$/, "");
  if (req && (req.originalUrl?.includes("/openai/") || req.baseUrl?.includes("/openai/") || req.path?.includes("/openai/"))) {
    return `${base}/openai/.well-known/oauth-protected-resource`;
  }
  return `${base}/.well-known/oauth-protected-resource`;
}

function safeSetHeader(res: Response, header: string, value: string): void {
  try {
    if (typeof res.setHeader === "function") {
      res.setHeader(header, value);
    } else if (typeof (res as any).set === "function") {
      (res as any).set(header, value);
    } else if (typeof (res as any).header === "function") {
      (res as any).header(header, value);
    }
  } catch {
    // Non-fatal
  }
}

export async function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const resourceMetadataUrl = getProtectedResourceMetadataUrl(req);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    safeSetHeader(res, "WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
    res.status(401).json({
      error: "invalid_token",
      error_description: "Bearer token required",
      _meta: {
        "mcp/www_authenticate": [
          `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="Authentication required"`
        ]
      }
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    safeSetHeader(res, "WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token"`);
    res.status(401).json({
      error: "invalid_token",
      error_description: "Token missing",
      _meta: {
        "mcp/www_authenticate": [
          `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="Token missing"`
        ]
      }
    });
    return;
  }

  try {
    const { memberId, scopes } = await validateMcpAccessToken(token);

    // Attach validated context — identity is strictly bound to token sub
    req.mcpContext = { memberId, scopes };
    next();
  } catch (err: any) {
    logger.warn(`MCP auth verification failed: ${err.message}`, CTX);
    safeSetHeader(res, "WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token"`);
    res.status(401).json({
      error: "invalid_token",
      error_description: "Token is invalid, expired, or revoked",
      _meta: {
        "mcp/www_authenticate": [
          `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="Token is invalid or expired"`
        ]
      }
    });
  }
}
