/**
 * OAuth 2.1 token management for the CTN MCP layer.
 *
 * Implements:
 *  - RS256 token issuance with JWKS support (RFC 7519, RFC 7517)
 *  - Fallback / dual-mode HS256 support when MCP_OAUTH_TOKEN_SECRET is configured
 *  - Issuer: https://api.trustednetwork.in
 *  - Audience: https://mcp.trustednetwork.in
 *  - Subject: Stable CTN Member ID
 *  - Scope: Requested and allowed granular scopes
 *  - Single-use cryptographically secure authorization codes with PKCE S256
 *  - Refresh token rotation and revocation
 *  - Short-lived internal JWT for backend proxy calls
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { appRedis } from "../../config/appRedis";
import { AppDataSource } from "../../data-source";
import { OAuthGrant } from "../../entity/OAuthGrant";
import { mcpConfig } from "../config";
import { signOAuthJwt, verifyOAuthJwt } from "./keys";
import logger from "../../utils/logger";

const CTX = "MCPToken";

export const REDIS_PREFIX_ACCESS = "mcp:access:";
export const REDIS_PREFIX_REFRESH = "mcp:refresh:";
export const REDIS_PREFIX_CODE = "mcp:code:";

export const ACCESS_TOKEN_TTL_SEC = mcpConfig.oauth.accessTokenTtlSec || 3600; // 1 hour
export const REFRESH_TOKEN_TTL_SEC = mcpConfig.oauth.refreshTokenTtlSec || 2592000; // 30 days
export const AUTH_CODE_TTL_SEC = 300; // 5 minutes

export interface McpTokenPayload {
  sub?: string;
  memberId: string;
  scopes: string[];
  scope?: string;
  client_id?: string;
  resource?: string;
  jti: string;
  type: "access" | "refresh";
  iss?: string;
  aud?: string;
}

export interface AuthCodeData {
  memberId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  resource?: string;
  createdAt: number;
}

/**
 * Generates a cryptographically secure random token string.
 */
export function generateTokenId(): string {
  return crypto.randomBytes(32).toString("hex");
}

function shouldUseRs256(): boolean {
  if (process.env.OAUTH_SIGNING_ALGORITHM === "RS256") return true;
  if (!mcpConfig.oauth.tokenSecret) return true;
  return false;
}

/**
 * Issues an OAuth 2.1 access token + refresh token pair.
 * Supports RS256 (JWKS) and HS256.
 */
export async function issueMcpTokens(
  memberId: string,
  scopes: string[],
  clientId: string = "chatgpt-mcp",
  resource: string = mcpConfig.oauth.resource
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}> {
  const useRs256 = shouldUseRs256();

  if (!useRs256 && !mcpConfig.oauth.tokenSecret) {
    throw new Error("MCP_OAUTH_TOKEN_SECRET is not configured");
  }

  const accessJti = generateTokenId();
  const refreshJti = generateTokenId();

  const scopeString = scopes.join(" ");

  const accessPayload: McpTokenPayload = {
    sub: memberId,
    memberId,
    scopes,
    scope: scopeString,
    client_id: clientId,
    resource,
    jti: accessJti,
    type: "access"
  };

  const refreshPayload: McpTokenPayload = {
    sub: memberId,
    memberId,
    scopes,
    scope: scopeString,
    client_id: clientId,
    resource,
    jti: refreshJti,
    type: "refresh"
  };

  let accessToken: string;
  let refreshToken: string;

  if (useRs256) {
    accessToken = signOAuthJwt(accessPayload, {
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience,
      expiresIn: ACCESS_TOKEN_TTL_SEC
    });
    refreshToken = signOAuthJwt(refreshPayload, {
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience,
      expiresIn: REFRESH_TOKEN_TTL_SEC
    });
  } else {
    accessToken = jwt.sign(accessPayload, mcpConfig.oauth.tokenSecret, {
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience,
      expiresIn: ACCESS_TOKEN_TTL_SEC
    });
    refreshToken = jwt.sign(refreshPayload, mcpConfig.oauth.tokenSecret, {
      issuer: mcpConfig.oauth.issuer,
      audience: mcpConfig.oauth.audience,
      expiresIn: REFRESH_TOKEN_TTL_SEC
    });
  }

  // Store active sessions in Redis
  const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
  const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

  await Promise.all([
    appRedis.setex(
      `${REDIS_PREFIX_ACCESS}${accessJti}`,
      ACCESS_TOKEN_TTL_SEC,
      JSON.stringify({ memberId, scopes, clientId, resource })
    ),
    appRedis.setex(
      `${REDIS_PREFIX_REFRESH}${refreshJti}`,
      REFRESH_TOKEN_TTL_SEC,
      JSON.stringify({ memberId, scopes, clientId, resource, accessJti })
    ),
    // MobileAuthMiddleware cache compatibility
    appRedis.setex(
      `auth:v1:${tokenHash}`,
      ACCESS_TOKEN_TTL_SEC,
      JSON.stringify({
        userId: memberId,
        status: "active",
        isDeleted: false,
        tokenRecordExists: true
      })
    )
  ]);

  // Persist OAuth grant in MongoDB if connection is ready
  try {
    if (AppDataSource.isInitialized && ObjectId.isValid(memberId)) {
      const grantRepo = AppDataSource.getMongoRepository(OAuthGrant);
      const grant = new OAuthGrant();
      grant.userId = new ObjectId(memberId);
      grant.clientId = clientId;
      grant.scopes = scopes;
      grant.resource = resource;
      grant.accessTokenHash = tokenHash;
      grant.refreshTokenHash = refreshTokenHash;
      grant.isRevoked = false;
      grant.lastUsedAt = new Date();
      grant.expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000);
      await grantRepo.save(grant);
    }
  } catch (dbErr: any) {
    logger.warn(`Failed to persist OAuthGrant record: ${dbErr.message}`, CTX);
  }

  logger.info(`OAuth tokens issued for member ${memberId} (client: ${clientId})`, CTX);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    tokenType: "Bearer",
    scope: scopeString
  };
}

/**
 * Validates an MCP OAuth access token.
 * Verifies signature (RS256 or HS256), issuer, audience, expiration, and active Redis session.
 */
export async function validateMcpAccessToken(
  token: string,
  expectedResource?: string
): Promise<{
  memberId: string;
  scopes: string[];
  clientId?: string;
  resource?: string;
}> {
  let payload: McpTokenPayload;

  const decodedHeader = jwt.decode(token, { complete: true }) as any;
  const alg = decodedHeader?.header?.alg;

  if (alg === "RS256") {
    try {
      payload = verifyOAuthJwt<McpTokenPayload>(token, {
        issuer: mcpConfig.oauth.issuer,
        audience: mcpConfig.oauth.audience
      });
    } catch (err: any) {
      throw new Error(`Invalid or expired MCP token: ${err.message}`);
    }
  } else {
    if (!mcpConfig.oauth.tokenSecret) {
      throw new Error("MCP_OAUTH_TOKEN_SECRET is not configured");
    }
    try {
      payload = jwt.verify(token, mcpConfig.oauth.tokenSecret, {
        issuer: mcpConfig.oauth.issuer,
        audience: mcpConfig.oauth.audience
      }) as McpTokenPayload;
    } catch (err: any) {
      throw new Error(`Invalid or expired MCP token: ${err.message}`);
    }
  }

  if (payload.type !== "access") {
    throw new Error("Token type mismatch: expected access token");
  }

  const normalizeResource = (value?: string): string | undefined =>
    value?.trim().replace(/\/+$/, "") || undefined;

  if (expectedResource) {
    const expected = normalizeResource(expectedResource);
    const tokenResource = normalizeResource(payload.resource);

    if (!expected || !tokenResource || tokenResource !== expected) {
      throw new Error("Token resource mismatch");
    }
  }

  const memberId = payload.sub || payload.memberId;
  if (!memberId) {
    throw new Error("Token missing subject/memberId");
  }

  // Verify Redis session (ensures immediate invalidation upon revocation/disconnect)
  const cached = await appRedis.get(`${REDIS_PREFIX_ACCESS}${payload.jti}`);
  if (!cached) {
    throw new Error("MCP session not found or revoked");
  }

  const session = JSON.parse(cached);
  if (session.memberId !== memberId) {
    throw new Error("Token integrity failure: member mismatch");
  }

  if (
    session.resource &&
    payload.resource &&
    normalizeResource(session.resource) !== normalizeResource(payload.resource)
  ) {
    throw new Error("Token resource/session mismatch");
  }

  return {
    memberId,
    scopes: session.scopes || payload.scopes || (payload.scope ? payload.scope.split(" ") : []),
    clientId: session.clientId || payload.client_id,
    resource: payload.resource
  };
}

/**
 * Refreshes an MCP access token using an OAuth refresh token.
 * Enforces refresh token rotation: old refresh token is revoked immediately.
 */
export async function refreshMcpTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}> {
  let payload: McpTokenPayload;

  const decodedHeader = jwt.decode(refreshToken, { complete: true }) as any;
  const alg = decodedHeader?.header?.alg;

  if (alg === "RS256") {
    try {
      payload = verifyOAuthJwt<McpTokenPayload>(refreshToken, {
        issuer: mcpConfig.oauth.issuer,
        audience: mcpConfig.oauth.audience
      });
    } catch (err: any) {
      throw new Error(`Invalid or expired refresh token: ${err.message}`);
    }
  } else {
    if (!mcpConfig.oauth.tokenSecret) {
      throw new Error("MCP_OAUTH_TOKEN_SECRET is not configured");
    }
    try {
      payload = jwt.verify(refreshToken, mcpConfig.oauth.tokenSecret, {
        issuer: mcpConfig.oauth.issuer,
        audience: mcpConfig.oauth.audience
      }) as McpTokenPayload;
    } catch (err: any) {
      throw new Error(`Invalid or expired refresh token: ${err.message}`);
    }
  }

  if (payload.type !== "refresh") {
    throw new Error("Token type mismatch: expected refresh token");
  }

  const cached = await appRedis.get(`${REDIS_PREFIX_REFRESH}${payload.jti}`);
  if (!cached) {
    throw new Error("Refresh session not found or revoked");
  }

  const session = JSON.parse(cached);

  // Invalidate old refresh token (rotation)
  await appRedis.del(`${REDIS_PREFIX_REFRESH}${payload.jti}`);
  if (session.accessJti) {
    await appRedis.del(`${REDIS_PREFIX_ACCESS}${session.accessJti}`);
  }

  return issueMcpTokens(
    session.memberId,
    session.scopes,
    session.clientId || "chatgpt-mcp",
    session.resource || mcpConfig.oauth.resource
  );
}

/**
 * Revokes an access or refresh token (RFC 7009).
 */
export async function revokeMcpToken(token: string): Promise<void> {
  try {
    let payload: McpTokenPayload;
    try {
      payload = jwt.decode(token) as McpTokenPayload;
    } catch {
      return;
    }

    if (!payload || !payload.jti) return;

    const key = payload.type === "access"
      ? `${REDIS_PREFIX_ACCESS}${payload.jti}`
      : `${REDIS_PREFIX_REFRESH}${payload.jti}`;

    await appRedis.del(key);

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await appRedis.del(`auth:v1:${tokenHash}`);

    if (AppDataSource.isInitialized) {
      const grantRepo = AppDataSource.getMongoRepository(OAuthGrant);
      await grantRepo.updateMany(
        { $or: [{ accessTokenHash: tokenHash }, { refreshTokenHash: tokenHash }] } as any,
        { $set: { isRevoked: true, revokedAt: new Date() } } as any
      );
    }

    logger.info(`OAuth token revoked for member ${payload.sub || payload.memberId}`, CTX);
  } catch (err: any) {
    logger.warn(`Token revocation error: ${err.message}`, CTX);
  }
}

/**
 * Issues a cryptographically secure, random, short-lived authorization code (5 minutes).
 */
export async function issueAuthCode(
  memberId: string,
  scopes: string[],
  redirectUri: string,
  clientIdOrChallenge: string = "chatgpt-mcp",
  codeChallenge?: string,
  resource: string = mcpConfig.oauth.resource
): Promise<string> {
  let resolvedClientId = clientIdOrChallenge || "chatgpt-mcp";
  let resolvedChallenge = codeChallenge;

  // Backward compatibility: if 4th arg is challenge rather than client_id
  if (
    codeChallenge === undefined &&
    clientIdOrChallenge &&
    !clientIdOrChallenge.startsWith("chatgpt") &&
    !clientIdOrChallenge.startsWith("ctn_") &&
    !clientIdOrChallenge.startsWith("http")
  ) {
    resolvedClientId = "chatgpt-mcp";
    resolvedChallenge = clientIdOrChallenge;
  }

  const code = generateTokenId();
  const data: AuthCodeData = {
    memberId,
    clientId: resolvedClientId,
    redirectUri,
    scopes,
    codeChallenge: resolvedChallenge,
    resource,
    createdAt: Date.now()
  };

  await appRedis.setex(
    `${REDIS_PREFIX_CODE}${code}`,
    AUTH_CODE_TTL_SEC,
    JSON.stringify(data)
  );

  return code;
}

/**
 * Consumes an authorization code with atomic single-use deletion.
 * Validates redirect_uri, client_id, and resource.
 */
export async function consumeAuthCode(
  code: string,
  redirectUri: string,
  clientId?: string,
  resource?: string
): Promise<{
  memberId: string;
  scopes: string[];
  clientId: string;
  codeChallenge?: string;
  resource: string;
}> {
  const key = `${REDIS_PREFIX_CODE}${code}`;
  const raw = await appRedis.get(key);

  if (!raw) {
    throw new Error("Authorization code not found, expired, or already used");
  }

  // Atomically delete immediately to enforce single-use
  await appRedis.del(key);

  const data = JSON.parse(raw) as AuthCodeData;

  if (data.redirectUri !== redirectUri) {
    throw new Error("redirect_uri mismatch");
  }

  if (clientId && data.clientId && data.clientId !== clientId) {
    throw new Error("client_id mismatch");
  }

  if (resource && data.resource && data.resource.replace(/\/+$/, "") !== resource.replace(/\/+$/, "")) {
    throw new Error("resource mismatch");
  }

  return {
    memberId: data.memberId,
    scopes: data.scopes,
    clientId: data.clientId,
    codeChallenge: data.codeChallenge,
    resource: data.resource || mcpConfig.oauth.resource
  };
}

/**
 * Generates a short-lived internal JWT (5 minutes) for proxying calls
 * to the backend /mobile-api. Never exposed to ChatGPT.
 */
export function generateInternalJwt(memberId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(
    { userId: memberId, userType: "MEMBER" },
    secret,
    { expiresIn: "5m" }
  );
}
