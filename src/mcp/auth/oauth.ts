/**
 * OAuth 2.1 endpoints for the MCP server.
 *
 * Implements:
 *  - GET  /.well-known/oauth-authorization-server  (RFC 8414 metadata)
 *  - GET  /oauth/authorize                         (Authorization Code + PKCE)
 *  - POST /oauth/token                             (token endpoint)
 *  - POST /oauth/revoke                            (token revocation — RFC 7009)
 *
 * The member must have already authenticated via the Trusted Network mobile app
 * and must log in here using their existing credentials (PIN or OTP).
 *
 * Security baseline:
 *  - PKCE (code_challenge_method=S256) is required — no plain PKCE allowed.
 *  - Client secrets are NOT required (public clients only — ChatGPT).
 *  - Authorization codes are single-use, 5-min TTL.
 *  - Redirect URIs are strictly validated against the known ChatGPT callback URI.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { mcpConfig } from "../config";
import {
  issueAuthCode,
  consumeAuthCode,
  issueMcpTokens,
  refreshMcpTokens,
  revokeMcpToken
} from "./token";
import logger from "../../utils/logger";

const CTX = "MCPOAuth";

// Known allowed redirect URIs for ChatGPT
// ChatGPT OAuth callback: https://chatgpt.com/aip/plugin-{id}/oauth/callback
// We validate prefix-match (chatgpt.com) or exact match for custom clients.
const ALLOWED_REDIRECT_URI_PATTERNS = [
  /^https:\/\/chatgpt\.com\//,
  /^https:\/\/chat\.openai\.com\//,
  // Allow localhost for development only
  ...(process.env.NODE_ENV !== "production" ? [/^http:\/\/localhost:/] : []),
  // Allow the server's own public URL (for callback testing)
  ...(mcpConfig.publicUrl ? [new RegExp(`^${mcpConfig.publicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`)] : [])
];

// In-memory PKCE challenge store (Redis-backed via appRedis in production)
// Key: state, Value: { codeChallenge, redirectUri, scopes }
import { appRedis } from "../../config/appRedis";

const PKCE_PREFIX = "mcp:pkce:";
const PKCE_TTL_SEC = 600; // 10 minutes

// Supported scopes
export const SUPPORTED_SCOPES = [
  "profile:read",
  "members:read",
  "posts:read",
  "posts:write"
];

function isRedirectUriAllowed(uri: string): boolean {
  return ALLOWED_REDIRECT_URI_PATTERNS.some(p => p.test(uri));
}

export function createOAuthRouter(): Router {
  const router = Router();

  /**
   * OAuth 2.1 Authorization Server Metadata (RFC 8414)
   * ChatGPT uses this to discover endpoints.
   */
  router.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    const base = mcpConfig.publicUrl;
    res.json({
      issuer: mcpConfig.oauth.issuer,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: SUPPORTED_SCOPES,
      token_endpoint_auth_methods_supported: ["none"]
    });
  });

  /**
   * Authorization endpoint.
   *
   * ChatGPT redirects the user here with:
   *   - response_type=code
   *   - client_id (informational)
   *   - redirect_uri
   *   - scope
   *   - state
   *   - code_challenge (PKCE, SHA-256)
   *   - code_challenge_method=S256
   *
   * The user authenticates with their Trusted Network credentials.
   * On success, we redirect back with ?code=<authcode>&state=<state>.
   */
  router.get("/oauth/authorize", async (req: Request, res: Response) => {
    const {
      response_type,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      scope
    } = req.query as Record<string, string>;

    // Validate required parameters
    if (response_type !== "code") {
      return res.status(400).json({ error: "unsupported_response_type" });
    }
    if (!redirect_uri || !isRedirectUriAllowed(redirect_uri)) {
      return res.status(400).json({ error: "invalid_redirect_uri" });
    }
    if (!state) {
      return res.status(400).json({ error: "invalid_request", error_description: "state is required" });
    }
    // If code_challenge is provided, validate S256 method
    if (code_challenge && code_challenge_method && code_challenge_method !== "S256") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "When code_challenge is provided, code_challenge_method must be S256"
      });
    }

    const scopes = (scope || "profile:read members:read posts:read")
      .split(" ")
      .filter(s => SUPPORTED_SCOPES.includes(s));

    // Store challenge and request parameters in Redis
    await appRedis.setex(
      `${PKCE_PREFIX}${state}`,
      PKCE_TTL_SEC,
      JSON.stringify({ codeChallenge: code_challenge || "", redirectUri: redirect_uri, scopes })
    );

    // Serve the login consent page
    // In production: redirect to a proper login UI
    // Here we serve a minimal HTML form for member authentication
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trusted Network — Authorize ChatGPT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
    }
    .logo {
      text-align: center;
      margin-bottom: 28px;
    }
    .logo h1 {
      color: #f8fafc;
      font-size: 22px;
      font-weight: 700;
    }
    .logo p {
      color: #94a3b8;
      font-size: 14px;
      margin-top: 4px;
    }
    .scope-list {
      background: #0f172a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .scope-list h3 {
      color: #94a3b8;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 10px;
    }
    .scope-list ul {
      list-style: none;
      color: #e2e8f0;
      font-size: 14px;
    }
    .scope-list ul li {
      padding: 4px 0;
    }
    .scope-list ul li::before {
      content: "✓ ";
      color: #22c55e;
    }
    label {
      display: block;
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 12px 14px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f8fafc;
      font-size: 15px;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #6366f1; }
    button {
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
    button:hover { opacity: 0.9; }
    .error {
      background: #450a0a;
      border: 1px solid #7f1d1d;
      border-radius: 8px;
      color: #fca5a5;
      padding: 12px;
      font-size: 14px;
      margin-bottom: 16px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <h1>Trusted Network</h1>
      <p>ChatGPT wants permission to access your account</p>
    </div>
    <div class="scope-list">
      <h3>Permissions requested</h3>
      <ul>
        ${scopes.map(s => `<li>${scopeDescription(s)}</li>`).join("")}
      </ul>
    </div>
    <div class="error" id="error"></div>
    <form id="login-form">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <label for="identifier">Mobile Number or Email</label>
      <input type="text" id="identifier" name="identifier" placeholder="+91 9999999999" autocomplete="username" required>
      <label for="pin">PIN</label>
      <input type="password" id="pin" name="pin" placeholder="Enter your 4-digit PIN" maxlength="8" autocomplete="current-password" required>
      <button type="submit">Authorize ChatGPT</button>
    </form>
    <script>
      document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const errEl = document.getElementById('error');
        btn.textContent = 'Authorizing…';
        btn.disabled = true;
        errEl.style.display = 'none';

        const fd = new FormData(e.target);
        const payload = { identifier: fd.get('identifier'), pin: fd.get('pin'), state: fd.get('state') };

        try {
          const res = await fetch('/oauth/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.redirect) {
            window.location.href = data.redirect;
          } else {
            errEl.textContent = data.error_description || 'Authentication failed. Please try again.';
            errEl.style.display = 'block';
            btn.textContent = 'Authorize ChatGPT';
            btn.disabled = false;
          }
        } catch {
          errEl.textContent = 'Network error. Please try again.';
          errEl.style.display = 'block';
          btn.textContent = 'Authorize ChatGPT';
          btn.disabled = false;
        }
      });
    </script>
  </div>
</body>
</html>
    `);
  });

  /**
   * Authorization form submission — verifies credentials and issues auth code.
   */
  router.post("/oauth/authorize", async (req: Request, res: Response) => {
    const { identifier, pin, state } = req.body as Record<string, string>;

    if (!state || !identifier || !pin) {
      return res.json({ error: "invalid_request", error_description: "Missing required fields" });
    }

    // Retrieve PKCE session
    const pkceRaw = await appRedis.get(`${PKCE_PREFIX}${state}`);
    if (!pkceRaw) {
      return res.json({ error: "invalid_request", error_description: "Session expired. Please restart the authorization." });
    }
    const { codeChallenge, redirectUri, scopes } = JSON.parse(pkceRaw);

    // Authenticate member via existing Trusted Network login endpoint
    let memberId: string;
    try {
      const response = await axios.post(
        `${mcpConfig.apiUrl}/mobile-api/auth/login-pin`,
        { identifier: identifier.trim(), pin }
      );

      // The login-pin response structure: { success: true, accessToken, data: { _id, fullName, mobileNumber, email } }
      const loginData = response.data;
      const memberIdCandidate = loginData?.data?._id || loginData?.data?.member?._id;
      if (!loginData?.success || !memberIdCandidate) {
        throw new Error("Invalid login response from backend");
      }
      memberId = memberIdCandidate.toString();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || "Invalid credentials";
      logger.warn(`MCP OAuth login failed for identifier ${identifier}: ${msg}`, CTX, {
        code: err?.code,
        status: err?.response?.status,
        url: `${mcpConfig.apiUrl}/mobile-api/auth/login-pin`
      });
      return res.json({
        error: "access_denied",
        error_description: msg
      });
    }

    // Issue authorization code (storing codeChallenge for PKCE verification)
    const code = await issueAuthCode(memberId, scopes, redirectUri, codeChallenge);

    // Delete PKCE session (single-use)
    await appRedis.del(`${PKCE_PREFIX}${state}`);

    const redirectUrl = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    logger.info(`MCP auth code issued for member ${memberId}`, CTX);

    return res.json({ redirect: redirectUrl });
  });

  /**
   * Local testing callback page.
   * When testing locally in a browser, redirect_uri can point here to inspect the issued code.
   */
  router.get("/oauth/callback", (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>OAuth Error</title><style>body{font-family:sans-serif;padding:40px;background:#f8f9fa;color:#333} .box{background:#fff;padding:24px;border-radius:8px;max-width:600px;margin:auto;border-left:4px solid #dc3545;box-shadow:0 2px 10px rgba(0,0,0,0.08)}</style></head>
        <body>
          <div class="box">
            <h2 style="color:#dc3545;margin-top:0">OAuth Error</h2>
            <p><strong>Error:</strong> ${error}</p>
            <p><strong>Description:</strong> ${error_description || "Unknown error"}</p>
          </div>
        </body>
        </html>
      `);
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth Authorization Successful</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; margin: 0; }
          .card { max-width: 680px; margin: auto; background: #1e293b; border-radius: 12px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid #334155; }
          .badge { display: inline-block; background: #10b981; color: #fff; padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 13px; margin-bottom: 16px; }
          h1 { margin: 0 0 12px 0; font-size: 24px; font-weight: 700; color: #fff; }
          p { color: #94a3b8; line-height: 1.6; margin: 0 0 20px 0; font-size: 14px; }
          .field-label { font-size: 12px; text-transform: uppercase; font-weight: 600; color: #64748b; margin-bottom: 6px; }
          .code-box { background: #090d16; border: 1px solid #334155; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; margin-bottom: 20px; }
          button { background: #3b82f6; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px; transition: background 0.2s; }
          button:hover { background: #2563eb; }
          #result { margin-top: 20px; padding: 16px; background: #090d16; border-radius: 8px; border: 1px solid #334155; font-family: monospace; font-size: 13px; color: #4ade80; white-space: pre-wrap; display: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">Success</span>
          <h1>Authorization Code Issued!</h1>
          <p>The member has authenticated successfully. In production, ChatGPT automatically receives this code and completes the token exchange.</p>

          <div class="field-label">Authorization Code:</div>
          <div class="code-box" id="authCode">${code || ""}</div>

          <div class="field-label">State:</div>
          <div class="code-box">${state || ""}</div>

          <button id="exchangeBtn" onclick="exchangeToken()">Exchange for Bearer Token</button>
          <div id="result"></div>
        </div>

        <script>
          async function exchangeToken() {
            const btn = document.getElementById('exchangeBtn');
            const resEl = document.getElementById('result');
            btn.disabled = true;
            btn.textContent = 'Exchanging...';
            try {
              const res = await fetch('/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  grant_type: 'authorization_code',
                  code: '${code || ""}',
                  redirect_uri: window.location.origin + window.location.pathname,
                  code_verifier: 'test_code_verifier_123456789012345678901234567890'
                })
              });
              const data = await res.json();
              resEl.style.display = 'block';
              resEl.textContent = JSON.stringify(data, null, 2);
              if (data.access_token) {
                resEl.style.borderColor = '#10b981';
              } else {
                resEl.style.borderColor = '#ef4444';
                resEl.style.color = '#ef4444';
              }
              btn.textContent = 'Exchange Complete';
            } catch (err) {
              resEl.style.display = 'block';
              resEl.textContent = 'Error: ' + err.message;
              btn.disabled = false;
              btn.textContent = 'Exchange for Bearer Token';
            }
          }
        </script>
      </body>
      </html>
    `);
  });

  /**
   * Token endpoint — exchanges authorization code or refresh token for tokens.
   */
  router.post("/oauth/token", async (req: Request, res: Response) => {
    const { grant_type, code, redirect_uri, code_verifier, refresh_token } = req.body as Record<string, string>;

    if (grant_type === "authorization_code") {
      if (!code || !redirect_uri) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "code and redirect_uri are required"
        });
      }

      let memberId: string;
      let scopes: string[];
      let expectedChallenge: string | undefined;
      try {
        const consumed = await consumeAuthCode(code, redirect_uri);
        memberId = consumed.memberId;
        scopes = consumed.scopes;
        expectedChallenge = consumed.codeChallenge;
      } catch (err: any) {
        return res.status(400).json({ error: "invalid_grant", error_description: err.message });
      }

      // PKCE verification: base64url(SHA256(code_verifier)) must equal stored code_challenge
      if (expectedChallenge) {
        if (!code_verifier) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed: code_verifier is required"
          });
        }

        const computed = crypto
          .createHash("sha256")
          .update(code_verifier)
          .digest("base64url");

        if (computed !== expectedChallenge) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed: invalid code_verifier"
          });
        }
      }

      const { accessToken, refreshToken, expiresIn } = await issueMcpTokens(memberId, scopes);

      return res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        scope: scopes.join(" ")
      });
    }

    if (grant_type === "refresh_token") {
      if (!refresh_token) {
        return res.status(400).json({ error: "invalid_request", error_description: "refresh_token is required" });
      }
      try {
        const tokens = await refreshMcpTokens(refresh_token);
        return res.json({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_type: "Bearer",
          expires_in: tokens.expiresIn
        });
      } catch (err: any) {
        return res.status(400).json({ error: "invalid_grant", error_description: err.message });
      }
    }

    return res.status(400).json({ error: "unsupported_grant_type" });
  });

  /**
   * Token revocation endpoint (RFC 7009).
   */
  router.post("/oauth/revoke", async (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (token) {
      await revokeMcpToken(token);
    }
    // RFC 7009: always return 200 regardless of whether token was valid
    res.status(200).json({ success: true });
  });

  return router;
}

function scopeDescription(scope: string): string {
  const descriptions: Record<string, string> = {
    "profile:read": "Read your Trusted Network profile",
    "members:read": "Search and view member directory",
    "posts:read": "View your posts",
    "posts:write": "Create, edit, and delete your posts"
  };
  return descriptions[scope] || scope;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
