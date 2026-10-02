/**
 * MCP authentication middleware.
 *
 * Validates the OAuth 2.1 Bearer token on every MCP request.
 * Resolves memberId and scopes. Adds them to the request context.
 *
 * Security rules:
 *  - Token MUST be in Authorization: Bearer header — not in query or body.
 *  - memberId comes ONLY from the validated token — never from tool arguments.
 *  - Token validation errors return 401 (not 403 — don't reveal what was wrong).
 */

import { Request, Response, NextFunction } from "express";
import { validateMcpAccessToken } from "../auth/token";
import logger from "../../utils/logger";

const CTX = "MCPAuthMiddleware";

export interface McpRequestContext {
  memberId: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpContext?: McpRequestContext;
    }
  }
}

export async function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      error_description: "Bearer token required"
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "unauthorized", error_description: "Token missing" });
    return;
  }

  try {
    const { memberId, scopes } = await validateMcpAccessToken(token);

    // Attach context — memberId always comes from token validation, never from request
    req.mcpContext = { memberId, scopes };

    next();
  } catch (err: any) {
    logger.warn(`MCP auth failed: ${err.message}`, CTX);
    res.status(401).json({
      error: "invalid_token",
      error_description: "Token is invalid or expired"
    });
  }
}
