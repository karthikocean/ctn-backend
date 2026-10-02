/**
 * OAuth 2.1 token management for the MCP layer.
 *
 * Architecture decision (confirmed by user):
 *   When a member authorizes ChatGPT, the MCP server:
 *     1. Issues its own short-lived MCP OAuth access token
 *     2. Stores { mcpTokenId -> memberId } mapping in Redis
 *     3. On each MCP tool call, resolves memberId from the MCP token
 *     4. Generates a short-lived internal JWT using the existing JWT_SECRET
 *        to call the existing /mobile-api routes on behalf of the member
 *
 * Security guarantees:
 *   - ChatGPT never touches the member's mobile app JWT
 *   - The model cannot supply or influence the authenticated userId
 *   - MCP OAuth tokens have a separate secret from mobile JWTs
 *   - Tokens are stored by opaque ID in Redis (not the raw JWT value as key)
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { appRedis } from "../../config/appRedis";
import { mcpConfig } from "../config";
import logger from "../../utils/logger";

const CTX = "MCPToken";

const REDIS_PREFIX_ACCESS = "mcp:access:";
const REDIS_PREFIX_REFRESH = "mcp:refresh:";
const REDIS_PREFIX_CODE = "mcp:code:";

// Seconds
const ACCESS_TOKEN_TTL_SEC = 3600;      // 1h
const REFRESH_TOKEN_TTL_SEC = 2592000;  // 30d
const AUTH_CODE_TTL_SEC = 300;          // 5min

export interface McpTokenPayload {
  /** MCP JWT token ID (jti) — used as Redis key suffix */
  jti: string;
  /** The Trusted Network member ID */
  memberId: string;
  /** Granted OAuth scopes */
  scopes: string[];
  /** Token type */
  type: "access" | "refresh";
}

/**
 * Generates a cryptographically secure random token ID.
 */
function generateTokenId(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Issues an MCP OAuth access + refresh token pair.
 * Stores membership in Redis so the token can be resolved without DB.
 */
export async function issueMcpTokens(memberId: string, scopes: string[]): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  if (!mcpConfig.oauth.tokenSecret) {
    throw new Error("MCP_OAUTH_TOKEN_SECRET is not configured");
  }

  const accessJti = generateTokenId();
  const refreshJti = generateTokenId();

  const accessPayload: McpTokenPayload = {
    jti: accessJti,
    memberId,
    scopes,
    type: "access"
  };

  const refreshPayload: McpTokenPayload = {
    jti: refreshJti,
    memberId,
    scopes,
    type: "refresh"
  };

  const accessToken = jwt.sign(accessPayload, mcpConfig.oauth.tokenSecret, {
    issuer: mcpConfig.oauth.issuer,
    audience: mcpConfig.oauth.audience,
    expiresIn: ACCESS_TOKEN_TTL_SEC
  });

  const refreshToken = jwt.sign(refreshPayload, mcpConfig.oauth.tokenSecret, {
    issuer: mcpConfig.oauth.issuer,
    audience: mcpConfig.oauth.audience,
    expiresIn: REFRESH_TOKEN_TTL_SEC
  });

  // Store in Redis
  await Promise.all([
    appRedis.setex(
      `${REDIS_PREFIX_ACCESS}${accessJti}`,
      ACCESS_TOKEN_TTL_SEC,
      JSON.stringify({ memberId, scopes })
    ),
    appRedis.setex(
      `${REDIS_PREFIX_REFRESH}${refreshJti}`,
      REFRESH_TOKEN_TTL_SEC,
      JSON.stringify({ memberId, scopes, accessJti })
    )
  ]);

  logger.info(`MCP tokens issued for member ${memberId}`, CTX);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC
  };
}

/**
 * Validates an MCP OAuth access token.
 * Returns the memberId and scopes if valid.
 * Throws on any failure — never returns partial data on error.
 */
export async function validateMcpAccessToken(token: string): Promise<{ memberId: string; scopes: string[] }> {
  if (!mcpConfig.oauth.tokenSecret) {
    throw new Error("MCP_OAUTH_TOKEN_SECRET is not configured");
  }

  let payload: McpTokenPayload;
  try {
    payload = jwt.verify(token, mcpConfig.oauth.tokenSecret, {
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience
    }) as McpTokenPayload;
  } catch (err: any) {
    throw new Error(`Invalid or expired MCP token: ${err.message}`);
  }

  if (payload.type !== "access") {
    throw new Error("Token type mismatch: expected access token");
  }

  // Verify Redis session (detects revocation, logout)
  const cached = await appRedis.get(`${REDIS_PREFIX_ACCESS}${payload.jti}`);
  if (!cached) {
    throw new Error("MCP session not found or revoked");
  }

  const session = JSON.parse(cached);
  if (session.memberId !== payload.memberId) {
    throw new Error("Token integrity failure");
  }

  return { memberId: payload.memberId, scopes: payload.scopes };
}

/**
 * Refreshes an MCP access token using a refresh token.
 */
export async function refreshMcpTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  if (!mcpConfig.oauth.tokenSecret) {
    throw new Error("MCP_OAUTH_TOKEN_SECRET is not configured");
  }

  let payload: McpTokenPayload;
  try {
    payload = jwt.verify(refreshToken, mcpConfig.oauth.tokenSecret, {
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience
    }) as McpTokenPayload;
  } catch (err: any) {
    throw new Error(`Invalid or expired refresh token: ${err.message}`);
  }

  if (payload.type !== "refresh") {
    throw new Error("Token type mismatch: expected refresh token");
  }

  const cached = await appRedis.get(`${REDIS_PREFIX_REFRESH}${payload.jti}`);
  if (!cached) {
    throw new Error("Refresh session not found or revoked");
  }

  const session = JSON.parse(cached);

  // Delete old refresh token (rotation)
  await appRedis.del(`${REDIS_PREFIX_REFRESH}${payload.jti}`);
  // Delete old access token
  if (session.accessJti) {
    await appRedis.del(`${REDIS_PREFIX_ACCESS}${session.accessJti}`);
  }

  return issueMcpTokens(session.memberId, session.scopes);
}

/**
 * Revokes an MCP token pair (logout).
 */
export async function revokeMcpToken(token: string): Promise<void> {
  if (!mcpConfig.oauth.tokenSecret) return;

  try {
    const payload = jwt.verify(token, mcpConfig.oauth.tokenSecret, {
      ignoreExpiration: true,
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience
    }) as McpTokenPayload;

    const key = payload.type === "access"
      ? `${REDIS_PREFIX_ACCESS}${payload.jti}`
      : `${REDIS_PREFIX_REFRESH}${payload.jti}`;

    await appRedis.del(key);
    logger.info(`MCP token revoked for member ${payload.memberId}`, CTX);
  } catch {
    // Token already invalid — safe to ignore
  }
}

/**
 * Issues a short-lived authorization code for the OAuth flow.
 * The code is exchanged for tokens in /token.
 */
export async function issueAuthCode(
  memberId: string,
  scopes: string[],
  redirectUri: string,
  codeChallenge?: string
): Promise<string> {
  const code = generateTokenId();
  await appRedis.setex(
    `${REDIS_PREFIX_CODE}${code}`,
    AUTH_CODE_TTL_SEC,
    JSON.stringify({ memberId, scopes, redirectUri, codeChallenge })
  );
  return code;
}

/**
 * Consumes an authorization code (single use) and returns the associated data.
 */
export async function consumeAuthCode(
  code: string,
  redirectUri: string
): Promise<{ memberId: string; scopes: string[]; codeChallenge?: string }> {
  const key = `${REDIS_PREFIX_CODE}${code}`;
  const raw = await appRedis.get(key);
  if (!raw) {
    throw new Error("Authorization code not found, expired, or already used");
  }

  const data = JSON.parse(raw);

  // Single-use: delete immediately
  await appRedis.del(key);

  if (data.redirectUri !== redirectUri) {
    throw new Error("redirect_uri mismatch");
  }

  return { memberId: data.memberId, scopes: data.scopes, codeChallenge: data.codeChallenge };
}

/**
 * Generates a short-lived internal JWT (using JWT_SECRET) to call the
 * existing /mobile-api routes on behalf of a member.
 *
 * This JWT is internal-only — never returned to ChatGPT.
 * It uses the same format as mobile app JWTs so MobileAuthMiddleware accepts it.
 */
export function generateInternalJwt(memberId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(
    { userId: memberId, userType: "MEMBER" },
    secret,
    { expiresIn: "5m" }  // Very short-lived — only used for one API call
  );
}
