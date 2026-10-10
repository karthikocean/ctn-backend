/**
 * Complete OAuth 2.1 Authorization Server Router for CTN & MCP.
 *
 * Implements:
 *  - GET  /.well-known/oauth-protected-resource    (MCP Protected Resource Metadata - RFC 9449/MCP)
 *  - GET  /.well-known/oauth-authorization-server  (Authorization Server Metadata - RFC 8414)
 *  - GET  /.well-known/jwks.json                   (Public JWKS - RFC 7517)
 *  - POST /oauth/register                          (Dynamic Client Registration - RFC 7591)
 *  - GET  /oauth/authorize                         (Login & Consent UI)
 *  - GET  /oauth/login                             (Dedicated OpenAI Reviewer Login UI)
 *  - POST /oauth/login                             (Mobile + PIN Authentication & Reviewer Verification)
 *  - POST /oauth/consent                           (Consent Approval / Denial)
 *  - POST /oauth/token                             (Token Exchange with PKCE S256 verification)
 *  - POST /oauth/revoke                            (Token Revocation - RFC 7009)
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { mcpConfig } from "../config";
import { clientRegistry } from "./clientRegistry";
import { getJwks } from "./keys";
import {
  issueAuthCode,
  consumeAuthCode,
  issueMcpTokens,
  refreshMcpTokens,
  revokeMcpToken
} from "./token";
import { appRedis } from "../../config/appRedis";
import logger from "../../utils/logger";

const CTX = "MCPOAuth";

const AUTH_TX_PREFIX = "mcp:auth_tx:";
const AUTH_TX_TTL_SEC = 600; // 10 minutes

// Supported OAuth scopes for CTN MCP
export const SUPPORTED_SCOPES = [
  "profile:read",
  "members:read",
  "posts:read",
  "posts:create"
];

function sanitizeString(val: any): string {
  if (typeof val !== "string") return "";
  return val.trim();
}

/**
 * Validates whether the given resource identifier is supported.
 * Supports the canonical resource URL and all MCP endpoint paths.
 */
export function isValidOAuthResource(resource: string): boolean {
  if (!resource || typeof resource !== "string") {
    return false;
  }

  const canonical = mcpConfig.oauth.resource.replace(/\/+$/, "");
  const normalized = resource.replace(/\/+$/, "");

  const supportedResources = [
    canonical,
    `${canonical}/mcp`,
    `${canonical}/openai/mcp`,
    `${canonical}/trusted-network/mcp`,
  ];

  return supportedResources.includes(normalized);
}

export function createOAuthRouter(): Router {
  const router = Router();

  /**
   * 1. Protected Resource Metadata (RFC 9449 / MCP)
   * GET /.well-known/oauth-protected-resource
   * GET /openai/.well-known/oauth-protected-resource
   */

  /**
   * Protected Resource Metadata (RFC 9728 / MCP)
   */
  const handleProtectedResourceMetadata = (
    req: Request,
    res: Response
  ) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const canonicalResource =
      mcpConfig.oauth.resource.replace(/\/+$/, "");

    const requestPath = req.path;
    const originalUrl = req.originalUrl.split("?")[0];

    let resourceTarget = canonicalResource;

    // Resolve the specific endpoint before the generic /mcp route.
    if (
      requestPath.includes("trusted-network/mcp") ||
      originalUrl.includes("trusted-network/mcp")
    ) {
      resourceTarget = `${canonicalResource}/trusted-network/mcp`;
    } else if (
      requestPath.includes("openai") ||
      originalUrl.includes("openai")
    ) {
      resourceTarget = `${canonicalResource}/openai/mcp`;
    } else if (
      requestPath.endsWith("/mcp") ||
      originalUrl.endsWith("/mcp")
    ) {
      resourceTarget = `${canonicalResource}/mcp`;
    } else if (typeof req.query.resource === "string") {
      const queryResource = req.query.resource.replace(/\/+$/, "");

      if (isValidOAuthResource(queryResource)) {
        resourceTarget = queryResource;
      }
    }

    return res.json({
      resource: resourceTarget,
      authorization_servers: [mcpConfig.oauth.issuer],
      scopes_supported: SUPPORTED_SCOPES,
    });
  };

  // Protected Resource Metadata discovery routes.
  router.get(
    "/.well-known/oauth-protected-resource",
    handleProtectedResourceMetadata
  );

  router.get(
    "/.well-known/oauth-protected-resource/openai/mcp",
    handleProtectedResourceMetadata
  );

  router.get(
    "/.well-known/oauth-protected-resource/mcp",
    handleProtectedResourceMetadata
  );

  router.get(
    "/.well-known/oauth-protected-resource/trusted-network/mcp",
    handleProtectedResourceMetadata
  );

  router.get(
    "/openai/.well-known/oauth-protected-resource",
    handleProtectedResourceMetadata
  );

  router.get(
    "/mcp/.well-known/oauth-protected-resource",
    handleProtectedResourceMetadata
  );

  // Protected Resource Metadata discovery routes (RFC 9449 / RFC 9728 / MCP specification)
  router.get("/.well-known/oauth-protected-resource", handleProtectedResourceMetadata);
  router.get("/.well-known/oauth-protected-resource/openai/mcp", handleProtectedResourceMetadata);
  router.get("/.well-known/oauth-protected-resource/mcp", handleProtectedResourceMetadata);
  router.get("/openai/.well-known/oauth-protected-resource", handleProtectedResourceMetadata);
  router.get("/mcp/.well-known/oauth-protected-resource", handleProtectedResourceMetadata);

  /**
   * 2. OAuth Authorization Server Metadata & OpenID Configuration (RFC 8414 / OIDC Core)
   * GET /.well-known/oauth-authorization-server
   * GET /.well-known/openid-configuration
   */
  const handleAuthServerMetadata = (_req: Request, res: Response) => {
    const issuer = mcpConfig.oauth.issuer;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");

    return res.json({
      issuer,
      authorization_response_iss_parameter_supported: true,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      registration_endpoint: `${issuer}/oauth/register`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: SUPPORTED_SCOPES,
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true
    });
  };

  router.get("/.well-known/oauth-authorization-server", handleAuthServerMetadata);
  router.get("/.well-known/openid-configuration", handleAuthServerMetadata);
  router.get("/openai/.well-known/oauth-authorization-server", handleAuthServerMetadata);
  router.get("/openai/.well-known/openid-configuration", handleAuthServerMetadata);

  /**
   * 3. Public JWKS (Step 30)
   * GET /.well-known/jwks.json
   */
  router.get("/.well-known/jwks.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json(getJwks());
  });

  /**
   * OpenAI Domain Verification Challenge Endpoints
   * GET /.well-known/openai-apps-challenge
   * GET /.well-known/openai-apps
   * Returns ONLY the configured verification token as plain text.
   * No JSON, no HTML, no quotes, no extra whitespace.
   */
  const handleDomainVerification = (_req: Request, res: Response) => {
    const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    if (!token || !token.trim()) {
      logger.error("OPENAI_APPS_CHALLENGE_TOKEN environment variable is missing or empty. OpenAI domain verification cannot succeed.", CTX);
      res.setHeader("Content-Type", "text/plain");
      return res.status(500).send("OpenAI domain verification token is not configured on this server");
    }
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).send(token.trim());
  };

  router.get("/.well-known/openai-apps-challenge", handleDomainVerification);
  router.get("/.well-known/openai-apps", handleDomainVerification);
  router.get("/openai/.well-known/openai-apps-challenge", handleDomainVerification);

  /**
   * 4. Dynamic Client Registration (Step 5)
   * POST /oauth/register
   */
  router.post("/oauth/register", async (req: Request, res: Response) => {
    try {
      const {
        client_name,
        redirect_uris,
        grant_types,
        response_types,
        token_endpoint_auth_method,
        scope
      } = req.body;

      const registered = await clientRegistry.registerClient({
        client_name,
        redirect_uris,
        grant_types,
        response_types,
        token_endpoint_auth_method,
        scope
      });

      return res.status(201).json(registered);
    } catch (err: any) {
      logger.warn(`DCR failed: ${err.message}`, CTX);
      return res.status(400).json({
        error: "invalid_client_metadata",
        error_description: err.message
      });
    }
  });

  /**
   * 5. Authorization Endpoint (Step 7)
   * GET /oauth/authorize
   */
  router.get("/oauth/authorize", async (req: Request, res: Response) => {
    const {
      response_type,
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      scope,
      resource
    } = req.query as Record<string, string>;

    // 1. Validate response_type
    if (response_type !== "code") {
      return res.status(400).json({
        error: "unsupported_response_type",
        error_description: "response_type must be code"
      });
    }

    // 2. Validate client_id
    if (!client_id) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "client_id is required"
      });
    }

    // 3. Validate state
    if (!state) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "state is required"
      });
    }

    // 4. Validate redirect_uri & client
    if (!redirect_uri) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri is required"
      });
    }

    // Prohibit legacy internal callback for ChatGPT
    if (redirect_uri.includes("/oauth/callback") && client_id.includes("chatgpt")) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "The internal callback URL is not permitted for ChatGPT integration. Use the official ChatGPT callback URI."
      });
    }

    try {
      await clientRegistry.validateClient(client_id, redirect_uri);
    } catch (err: any) {
      logger.warn(`Client validation failed for client_id=${client_id}: ${err.message}`, CTX);
      return res.status(400).json({
        error: "invalid_client",
        error_description: err.message
      });
    }

    // 5. Validate PKCE
    if (!code_challenge) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "code_challenge is required"
      });
    }

    if (!code_challenge_method || code_challenge_method !== "S256") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "code_challenge_method must be S256"
      });
    }

    // 6. Validate resource parameter (Step 7)
    const canonicalResource = mcpConfig.oauth.resource.replace(/\/+$/, "");
    let resolvedResource = canonicalResource;
    if (resource) {
      const normalizedResource = resource.replace(/\/+$/, "");
      if (!isValidOAuthResource(normalizedResource)) {
        return res.status(400).json({
          error: "invalid_target",
          error_description: `Unsupported resource: ${resource}. Expected ${canonicalResource}`
        });
      }
      resolvedResource = normalizedResource;
    }

    // 7. Validate scopes
    const requestedScopeString = scope || "profile:read members:read posts:read posts:create";
    const requestedScopes = requestedScopeString.split(/\s+/).filter(Boolean);
    const invalidScopes = requestedScopes.filter((s) => !SUPPORTED_SCOPES.includes(s));

    if (invalidScopes.length > 0) {
      return res.status(400).json({
        error: "invalid_scope",
        error_description: `Unsupported scope(s): ${invalidScopes.join(", ")}`
      });
    }

    // Store transaction in Redis
    const txData = {
      clientId: client_id,
      redirectUri: redirect_uri,
      scopes: requestedScopes,
      state,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      resource: resolvedResource,
      createdAt: Date.now()
    };

    await appRedis.setex(
      `${AUTH_TX_PREFIX}${state}`,
      AUTH_TX_TTL_SEC,
      JSON.stringify(txData)
    );

    logger.info(JSON.stringify({
      event: "CHATGPT_OAUTH_AUTHORIZE_STARTED",
      clientId: client_id,
      redirectUri: redirect_uri,
      scopes: requestedScopes,
      timestamp: new Date().toISOString()
    }), CTX);

    // Render Login / Consent HTML UI
    return res.send(renderAuthPage({
      state,
      redirectUri: redirect_uri,
      scopes: requestedScopes,
      clientId: client_id
    }));
  });

  /**
   * Dedicated OpenAI Reviewer Login Page
   * GET /oauth/login
   *
   * Renders the login UI in standalone verification mode.
   * Reviewers can verify demo credentials without SMS OTP or MFA.
   * This endpoint NEVER issues authorization codes, access tokens, or refresh tokens.
   */
  router.get("/oauth/login", (_req: Request, res: Response) => {
    return res.send(renderAuthPage({
      isStandalone: true
    }));
  });

  /**
   * 6. CTN Member Login (Step 8 & Standalone Reviewer Verification)
   * POST /oauth/login
   */
  router.post("/oauth/login", async (req: Request, res: Response) => {
    const { identifier, pin, state } = req.body as Record<string, string>;

    if (!identifier || !pin) {
      return res.status(400).json({
        success: false,
        error: "invalid_request",
        error_description: "Missing required credentials (identifier and pin)"
      });
    }

    // Standalone Reviewer Verification Mode (no OAuth transaction state)
    // Validates credentials without issuing authorization codes or tokens
    if (!state) {
      try {
        const response = await axios.post(
          `${mcpConfig.apiUrl}/mobile-api/auth/login-pin`,
          { identifier: identifier.trim(), pin }
        );

        const loginData = response.data;
        const member = loginData?.data;
        const memberId = member?._id || member?.member?._id;

        if (!loginData?.success || !memberId) {
          throw new Error(loginData?.message || "Invalid credentials");
        }

        const fullName = member.fullName || member.name || "Member";
        const mobileNumber = member.mobileNumber || member.phone || "";

        logger.info(JSON.stringify({
          event: "STANDALONE_REVIEWER_LOGIN_VERIFIED",
          userId: memberId.toString(),
          timestamp: new Date().toISOString()
        }), CTX);

        // Security requirement: Standalone route never issues tokens or codes
        return res.json({
          success: true,
          standalone: true,
          member: {
            fullName,
            mobileNumber
          }
        });
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || "Invalid mobile number or PIN";
        return res.status(401).json({
          success: false,
          error: "access_denied",
          error_description: msg
        });
      }
    }

    // OAuth Authorization Flow (state provided)
    const txRaw = await appRedis.get(`${AUTH_TX_PREFIX}${state}`);
    if (!txRaw) {
      return res.status(400).json({
        success: false,
        error: "invalid_request",
        error_description: "Authorization session expired. Please restart the connection flow."
      });
    }

    try {
      // Validate credentials against existing CTN authentication route
      const response = await axios.post(
        `${mcpConfig.apiUrl}/mobile-api/auth/login-pin`,
        { identifier: identifier.trim(), pin }
      );

      const loginData = response.data;
      const member = loginData?.data;
      const memberId = member?._id || member?.member?._id;

      if (!loginData?.success || !memberId) {
        throw new Error(loginData?.message || "Invalid credentials");
      }

      // Update auth transaction with authenticated CTN member info
      const tx = JSON.parse(txRaw);
      tx.memberId = memberId.toString();
      tx.fullName = member.fullName || member.name || "Member";
      tx.mobileNumber = member.mobileNumber || member.phone || "";

      await appRedis.setex(
        `${AUTH_TX_PREFIX}${state}`,
        AUTH_TX_TTL_SEC,
        JSON.stringify(tx)
      );

      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_LOGIN_SUCCESS",
        userId: memberId.toString(),
        timestamp: new Date().toISOString()
      }), CTX);

      return res.json({
        success: true,
        member: {
          fullName: tx.fullName,
          mobileNumber: tx.mobileNumber
        }
      });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || "Invalid mobile number or PIN";
      return res.status(401).json({
        success: false,
        error: "access_denied",
        error_description: msg
      });
    }
  });

  /**
   * 7. Consent Submission (Step 9 & 10 & 11)
   * POST /oauth/consent
   */
  router.post("/oauth/consent", async (req: Request, res: Response) => {
    const { state, action } = req.body as { state?: string; action?: "allow" | "deny" };

    if (!state || !action) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "state and action are required"
      });
    }

    const txRaw = await appRedis.get(`${AUTH_TX_PREFIX}${state}`);
    if (!txRaw) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Session expired. Please restart the connection flow."
      });
    }

    const tx = JSON.parse(txRaw);

    // Consent Denied
    if (action === "deny") {
      await appRedis.del(`${AUTH_TX_PREFIX}${state}`);

      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_CONSENT_DENIED",
        clientId: tx.clientId,
        timestamp: new Date().toISOString()
      }), CTX);

      const redirectUrl = buildRedirectUrl(tx.redirectUri, {
        error: "access_denied",
        error_description: "User denied consent",
        state,
        iss: mcpConfig.oauth.issuer
      });

      return res.json({ redirect: redirectUrl });
    }

    // Consent Allowed
    if (!tx.memberId) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Authentication required before granting consent."
      });
    }

    // Generate cryptographically secure authorization code (Step 10)
    const code = await issueAuthCode(
      tx.memberId,
      tx.scopes,
      tx.redirectUri,
      tx.clientId,
      tx.codeChallenge,
      tx.resource
    );

    // Invalidate transaction session
    await appRedis.del(`${AUTH_TX_PREFIX}${state}`);

    logger.info(JSON.stringify({
      event: "CHATGPT_OAUTH_CONSENT_GRANTED",
      userId: tx.memberId,
      clientId: tx.clientId,
      scopes: tx.scopes,
      timestamp: new Date().toISOString()
    }), CTX);

    // Direct HTTP 302 redirect back to the exact ChatGPT callback (Step 11)
    const redirectUrl = buildRedirectUrl(tx.redirectUri, {
      code,
      state,
      iss: mcpConfig.oauth.issuer
    });

    return res.json({ redirect: redirectUrl });
  });

  /**
   * 8. Token Endpoint (Step 12, 13, 14)
   * POST /oauth/token
   */
  router.post("/oauth/token", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");

    const grantType = sanitizeString(req.body.grant_type);
    const code = sanitizeString(req.body.code);
    const redirectUri = sanitizeString(req.body.redirect_uri);
    const clientId = sanitizeString(req.body.client_id) || "chatgpt-mcp";
    const codeVerifier = sanitizeString(req.body.code_verifier);
    const refreshToken = sanitizeString(req.body.refresh_token);
    const resource = sanitizeString(req.body.resource);

    // A. Authorization Code Grant
    if (grantType === "authorization_code") {
      if (!code || !redirectUri) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "code and redirect_uri are required"
        });
      }

      let consumedData: {
        memberId: string;
        scopes: string[];
        clientId: string;
        codeChallenge?: string;
        resource: string;
      };

      try {
        consumedData = await consumeAuthCode(
          code,
          redirectUri,
          clientId,
          resource ? resource.replace(/\/+$/, "") : undefined
        );
      } catch (err: any) {
        logger.warn(`Authorization code consumption failed: ${err.message}`, CTX);
        return res.status(400).json({
          error: "invalid_grant",
          error_description: err.message
        });
      }

      // Validate PKCE verifier (RFC 7636)
      if (consumedData.codeChallenge) {
        if (!codeVerifier) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed: code_verifier is required"
          });
        }

        const computedChallenge = crypto
          .createHash("sha256")
          .update(codeVerifier)
          .digest("base64url");

        if (computedChallenge !== consumedData.codeChallenge) {
          logger.warn("PKCE verification failed: computed challenge mismatch", CTX);
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed: invalid code_verifier"
          });
        }
      }

      // Issue access and refresh tokens
      const tokens = await issueMcpTokens(
        consumedData.memberId,
        consumedData.scopes,
        consumedData.clientId,
        consumedData.resource
      );

      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_TOKEN_ISSUED",
        userId: consumedData.memberId,
        clientId: consumedData.clientId,
        scopes: consumedData.scopes,
        timestamp: new Date().toISOString()
      }), CTX);

      return res.status(200).json({
        access_token: tokens.accessToken,
        token_type: tokens.tokenType,
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope
      });
    }

    // B. Refresh Token Grant
    if (grantType === "refresh_token") {
      if (!refreshToken) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "refresh_token is required"
        });
      }

      try {
        const tokens = await refreshMcpTokens(refreshToken);

        logger.info(JSON.stringify({
          event: "CHATGPT_OAUTH_TOKEN_REFRESHED",
          timestamp: new Date().toISOString()
        }), CTX);

        return res.status(200).json({
          access_token: tokens.accessToken,
          token_type: tokens.tokenType,
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refreshToken,
          scope: tokens.scope
        });
      } catch (err: any) {
        logger.warn(`Token refresh failed: ${err.message}`, CTX);
        return res.status(400).json({
          error: "invalid_grant",
          error_description: err.message
        });
      }
    }

    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: `Unsupported grant_type: ${grantType}`
    });
  });

  /**
   * 9. Revocation Endpoint (Step 14)
   * POST /oauth/revoke
   */
  router.post("/oauth/revoke", async (req: Request, res: Response) => {
    const token = sanitizeString(req.body.token);
    if (token) {
      await revokeMcpToken(token);
      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_TOKEN_REVOKED",
        timestamp: new Date().toISOString()
      }), CTX);
    }
    return res.status(200).json({ success: true });
  });

  return router;
}

/**
 * Builds an absolute redirect URI including query parameters safely.
 */
function buildRedirectUrl(baseUri: string, params: Record<string, string>): string {
  const url = new URL(baseUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Returns human-readable scope descriptions for the consent screen.
 */
function getScopeDescription(scope: string): string {
  const descriptions: Record<string, string> = {
    "profile:read": "View your profile and membership details",
    "members:read": "Search verified business directory and nearby members",
    "posts:read": "View your posts and promotions",
    "posts:create": "Create business posts on your behalf"
  };
  return descriptions[scope] || `Access ${scope}`;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Renders the clean Trusted Network OAuth login and consent UI.
 */
function renderAuthPage(data: {
  state?: string;
  redirectUri?: string;
  scopes?: string[];
  clientId?: string;
  isStandalone?: boolean;
}): string {
  const isStandalone = !!data.isStandalone;
  const state = data.state || "";
  const redirectUri = data.redirectUri || "";
  const scopes = data.scopes || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${isStandalone ? "Trusted Network — Reviewer Verification" : "Trusted Network — Connect with ChatGPT"}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #f8fafc;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 36px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
    }
    .badge {
      display: inline-block;
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 4px 12px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .logo p {
      color: #94a3b8;
      font-size: 14px;
      margin-top: 6px;
    }
    .user-pill {
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 14px;
      color: #cbd5e1;
    }
    .user-pill strong { color: #38bdf8; }
    .scope-list {
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .scope-list h3 {
      color: #94a3b8;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .scope-list ul {
      list-style: none;
    }
    .scope-list ul li {
      padding: 6px 0;
      display: flex;
      align-items: center;
      font-size: 13.5px;
      color: #e2e8f0;
    }
    .scope-list ul li span.check {
      color: #10b981;
      font-weight: bold;
      margin-right: 10px;
      font-size: 16px;
    }
    label {
      display: block;
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 6px;
      font-weight: 500;
    }
    input {
      width: 100%;
      padding: 12px 14px;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f8fafc;
      font-size: 15px;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #6366f1; }
    .btn-primary {
      width: 100%;
      padding: 13px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary {
      width: 100%;
      padding: 12px;
      background: transparent;
      color: #94a3b8;
      border: 1px solid #334155;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 10px;
      transition: all 0.2s;
    }
    .btn-secondary:hover { background: #334155; color: #fff; }
    .error {
      background: #450a0a;
      border: 1px solid #7f1d1d;
      border-radius: 8px;
      color: #fca5a5;
      padding: 12px;
      font-size: 13.5px;
      margin-bottom: 16px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="text-align:center;">
      <span class="badge">${isStandalone ? "Reviewer Verification Portal" : "Trusted Network AI Integration"}</span>
    </div>

    <div class="logo">
      <h1>${isStandalone ? "OpenAI Reviewer Login" : "Connect with ChatGPT"}</h1>
      <p id="subheading">${isStandalone ? "Sign in with dedicated reviewer demo credentials to verify account access." : "Log in to your Trusted Network account to grant permissions to ChatGPT."}</p>
    </div>

    <div class="error" id="error"></div>

    <!-- Screen 1: Mobile + PIN Login -->
    <div id="login-screen">
      <form id="login-form">
        <label for="identifier">${isStandalone ? "Reviewer Mobile Number" : "Mobile Number"}</label>
        <input type="text" id="identifier" name="identifier" placeholder="e.g. 9876543210" autocomplete="tel" required>

        <label for="pin">PIN</label>
        <input type="password" id="pin" name="pin" placeholder="Enter 4-digit PIN" maxlength="8" autocomplete="current-password" required>

        <button type="submit" class="btn-primary" id="loginBtn">${isStandalone ? "Verify Credentials" : "Continue"}</button>
      </form>
    </div>

    ${isStandalone ? `
    <!-- Screen 2 (Standalone): Verified Confirmation -->
    <div id="verified-screen" style="display: none;">
      <div class="user-pill" style="border-color: #10b981; background: rgba(16, 185, 129, 0.1);">
        <span style="color: #10b981; font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">✓ Credentials Verified</span>
        Connected as: <strong id="verifiedName">Member</strong>
        <span id="verifiedMobile" style="display:block; font-size:12px; color:#94a3b8; margin-top:2px;"></span>
      </div>
      <div style="background: #090d16; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 20px; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
        <p style="margin-bottom: 8px;"><strong>Reviewer Demo Account Active:</strong></p>
        <p style="color: #94a3b8;">This dedicated account is configured with synthetic demo records for MCP testing.</p>
        <p style="color: #94a3b8; margin-top: 8px;">To test MCP tools directly in ChatGPT, complete the connector authorization flow.</p>
      </div>
      <button type="button" class="btn-secondary" onclick="window.location.reload()">Sign In Again</button>
    </div>
    ` : `
    <!-- Screen 2 (OAuth): Consent Form -->
    <div id="consent-screen" style="display: none;">
      <div class="user-pill" id="userPill">
        Connected as: <strong id="userName">Member</strong>
        <span id="userMobile" style="display:block; font-size:12px; color:#94a3b8; margin-top:2px;"></span>
      </div>

      <div class="scope-list">
        <h3>Permissions requested</h3>
        <ul>
          ${scopes.map((s) => `<li><span class="check">✓</span> ${escapeHtml(getScopeDescription(s))}</li>`).join("")}
        </ul>
      </div>

      <button type="button" class="btn-primary" id="allowBtn">Allow Access</button>
      <button type="button" class="btn-secondary" id="denyBtn">Cancel</button>
    </div>
    `}
  </div>

  <script>
    const isStandalone = ${JSON.stringify(isStandalone)};
    const state = "${escapeHtml(state)}";
    const redirectUri = "${escapeHtml(redirectUri)}";
    const errEl = document.getElementById('error');

    function showError(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      btn.textContent = 'Verifying...';
      btn.disabled = true;
      errEl.style.display = 'none';

      const fd = new FormData(e.target);
      const payload = isStandalone
        ? { identifier: fd.get('identifier'), pin: fd.get('pin') }
        : { identifier: fd.get('identifier'), pin: fd.get('pin'), state: state };

      try {
        const res = await fetch('/oauth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resp = await res.json();
        if (resp.success) {
          if (isStandalone) {
            document.getElementById('verifiedName').textContent = resp.member.fullName;
            document.getElementById('verifiedMobile').textContent = resp.member.mobileNumber ? ('+91 ' + resp.member.mobileNumber) : '';
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('verified-screen').style.display = 'block';
            document.getElementById('subheading').textContent = 'Reviewer demo credentials verified successfully.';
          } else {
            document.getElementById('userName').textContent = resp.member.fullName;
            document.getElementById('userMobile').textContent = resp.member.mobileNumber ? ('+91 ' + resp.member.mobileNumber) : '';
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('consent-screen').style.display = 'block';
            document.getElementById('subheading').textContent = 'ChatGPT is requesting access to your account.';
          }
        } else {
          showError(resp.error_description || 'Invalid mobile number or PIN.');
          btn.textContent = isStandalone ? 'Verify Credentials' : 'Continue';
          btn.disabled = false;
        }
      } catch (err) {
        showError('Network error connecting to Trusted Network.');
        btn.textContent = isStandalone ? 'Verify Credentials' : 'Continue';
        btn.disabled = false;
      }
    });

    if (!isStandalone) {
      document.getElementById('allowBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('allowBtn');
        btn.textContent = 'Authorizing...';
        btn.disabled = true;
        errEl.style.display = 'none';

        try {
          const res = await fetch('/oauth/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, action: 'allow' })
          });
          const resp = await res.json();
          if (resp.redirect) {
            window.location.href = resp.redirect;
          } else {
            showError(resp.error_description || 'Authorization failed.');
            btn.textContent = 'Allow Access';
            btn.disabled = false;
          }
        } catch (err) {
          showError('Failed to complete authorization.');
          btn.textContent = 'Allow Access';
          btn.disabled = false;
        }
      });

      document.getElementById('denyBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('denyBtn');
        btn.textContent = 'Cancelling...';
        btn.disabled = true;

        try {
          const res = await fetch('/oauth/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, action: 'deny' })
          });
          const resp = await res.json();
          if (resp.redirect) {
            window.location.href = resp.redirect;
          } else {
            window.location.href = redirectUri + '?error=access_denied&error_description=User%20denied%20consent&state=' + encodeURIComponent(state);
          }
        } catch {
          window.location.href = redirectUri + '?error=access_denied&error_description=User%20denied%20consent&state=' + encodeURIComponent(state);
        }
      });
    }
  </script>
</body>
</html>`;
}
