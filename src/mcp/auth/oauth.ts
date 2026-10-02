/**
 * OAuth 2.1 endpoints for the MCP server.
 *
 * Implements:
 *  - GET  /.well-known/oauth-authorization-server  (RFC 8414 metadata)
 *  - GET  /oauth/authorize                         (Login & Consent UI)
 *  - POST /oauth/login                             (Step 1: Mobile + PIN validation)
 *  - POST /oauth/consent                           (Step 2: Allow / Deny consent)
 *  - POST /oauth/authorize                         (Direct authorization form submission)
 *  - POST /oauth/token                             (Token exchange)
 *  - POST /oauth/revoke                            (Token revocation — RFC 7009)
 *  - GET  /oauth/callback                          (Success / Return UI)
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
import { appRedis } from "../../config/appRedis";

const CTX = "MCPOAuth";

// Known allowed redirect URIs for ChatGPT & callback testing
const ALLOWED_REDIRECT_URI_PATTERNS = [
  /^https:\/\/chatgpt\.com\//,
  /^https:\/\/chat\.openai\.com\//,
  // Allow localhost for development only
  ...(process.env.NODE_ENV !== "production" ? [/^http:\/\/localhost:/] : []),
  // Allow the server's own public URL (for callback testing)
  ...(mcpConfig.publicUrl ? [new RegExp(`^${mcpConfig.publicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`)] : [])
];

const PKCE_PREFIX = "mcp:pkce:";
const PKCE_TTL_SEC = 600; // 10 minutes
const TICKET_PREFIX = "chatgpt:ticket:";
const AUTH_SESSION_PREFIX = "mcp:auth_session:";

// Supported granular scopes
export const SUPPORTED_SCOPES = [
  "profile:read",
  "members:read",
  "posts:read",
  "posts:create",
  "posts:write",
  "posts:update",
  "posts:delete",
  "promotions:read",
  "promotions:create",
  "promotions:update",
  "promotions:delete"
];

function isRedirectUriAllowed(uri: string): boolean {
  return ALLOWED_REDIRECT_URI_PATTERNS.some(p => p.test(uri));
}

export function createOAuthRouter(): Router {
  const router = Router();

  /**
   * OAuth 2.1 Authorization Server Metadata (RFC 8414)
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
   * Renders the Login page (if unauthenticated) or Consent screen (if pre-authenticated via ticket).
   */
  router.get("/oauth/authorize", async (req: Request, res: Response) => {
    const {
      response_type,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      scope,
      ticket
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
    if (code_challenge && code_challenge_method && code_challenge_method !== "S256") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "When code_challenge is provided, code_challenge_method must be S256"
      });
    }

    const scopes = (scope || "profile:read members:read posts:read posts:create")
      .split(" ")
      .filter(s => SUPPORTED_SCOPES.includes(s));

    // Store challenge and request parameters in Redis
    await appRedis.setex(
      `${PKCE_PREFIX}${state}`,
      PKCE_TTL_SEC,
      JSON.stringify({ codeChallenge: code_challenge || "", redirectUri: redirect_uri, scopes })
    );

    // Check if pre-authenticated ticket was provided by mobile app
    let preAuthMember: { fullName?: string; mobileNumber?: string } | null = null;
    if (ticket) {
      try {
        const ticketRaw = await appRedis.get(`${TICKET_PREFIX}${ticket}`);
        if (ticketRaw) {
          const parsed = JSON.parse(ticketRaw);
          preAuthMember = {
            fullName: parsed.fullName,
            mobileNumber: parsed.mobileNumber
          };
          // Pre-seed auth session for this state
          await appRedis.setex(
            `${AUTH_SESSION_PREFIX}${state}`,
            PKCE_TTL_SEC,
            JSON.stringify({
              memberId: parsed.memberId,
              fullName: parsed.fullName,
              mobileNumber: parsed.mobileNumber
            })
          );
        }
      } catch {
        // Fall back to login screen
      }
    }

    const hasPreAuth = !!preAuthMember;

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trusted Network — Connect with ChatGPT</title>
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
      <span class="badge">Trusted Network AI Integration</span>
    </div>

    <div class="logo">
      <h1>Connect with ChatGPT</h1>
      <p id="subheading">ChatGPT is requesting permission to access your Trusted Network account.</p>
    </div>

    <div class="error" id="error"></div>

    <!-- Screen 1: Login Form (Shown when unauthenticated) -->
    <div id="login-screen" style="display: ${hasPreAuth ? "none" : "block"};">
      <form id="login-form">
        <label for="identifier">Mobile Number</label>
        <input type="text" id="identifier" name="identifier" placeholder="e.g. 9876543210" autocomplete="tel" required>

        <label for="pin">PIN</label>
        <input type="password" id="pin" name="pin" placeholder="Enter your 4-digit PIN" maxlength="8" autocomplete="current-password" required>

        <button type="submit" class="btn-primary" id="loginBtn">Continue</button>
      </form>
    </div>

    <!-- Screen 2: Consent Form (Shown when authenticated) -->
    <div id="consent-screen" style="display: ${hasPreAuth ? "block" : "none"};">
      <div class="user-pill" id="userPill">
        Connected as: <strong id="userName">${escapeHtml(preAuthMember?.fullName || "Member")}</strong>
        <span id="userMobile" style="display:block; font-size:12px; color:#94a3b8; margin-top:2px;">
          ${escapeHtml(preAuthMember?.mobileNumber ? `+91 ${preAuthMember.mobileNumber}` : "")}
        </span>
      </div>

      <div class="scope-list">
        <h3>Permissions requested</h3>
        <ul>
          ${scopes.map(s => `<li><span class="check">✓</span> ${escapeHtml(scopeDescription(s))}</li>`).join("")}
        </ul>
      </div>

      <button type="button" class="btn-primary" id="allowBtn">Allow Access</button>
      <button type="button" class="btn-secondary" id="denyBtn">Cancel</button>
    </div>
  </div>

  <script>
    const state = "${escapeHtml(state)}";
    const redirectUri = "${escapeHtml(redirect_uri)}";
    const errEl = document.getElementById('error');

    function showError(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }

    // Step 1: Login Form Submission
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      btn.textContent = 'Verifying...';
      btn.disabled = true;
      errEl.style.display = 'none';

      const fd = new FormData(e.target);
      const payload = {
        identifier: fd.get('identifier'),
        pin: fd.get('pin'),
        state: state
      };

      try {
        const res = await fetch('/oauth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          // Transition to Consent Screen
          document.getElementById('userName').textContent = data.member.fullName;
          document.getElementById('userMobile').textContent = '+91 ' + data.member.mobileNumber;
          document.getElementById('login-screen').style.display = 'none';
          document.getElementById('consent-screen').style.display = 'block';
        } else {
          showError(data.error_description || 'Invalid mobile number or PIN.');
          btn.textContent = 'Continue';
          btn.disabled = false;
        }
      } catch (err) {
        showError('Network error connecting to Trusted Network.');
        btn.textContent = 'Continue';
        btn.disabled = false;
      }
    });

    // Step 2: Consent - Allow
    document.getElementById('allowBtn').addEventListener('click', async () => {
      const btn = document.getElementById('allowBtn');
      btn.textContent = 'Connecting...';
      btn.disabled = true;
      errEl.style.display = 'none';

      try {
        const res = await fetch('/oauth/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, action: 'allow' })
        });
        const data = await res.json();
        if (data.redirect) {
          window.location.href = data.redirect;
        } else {
          showError(data.error_description || 'Authorization failed.');
          btn.textContent = 'Allow Access';
          btn.disabled = false;
        }
      } catch (err) {
        showError('Failed to complete authorization.');
        btn.textContent = 'Allow Access';
        btn.disabled = false;
      }
    });

    // Step 2: Consent - Deny
    document.getElementById('denyBtn').addEventListener('click', async () => {
      const btn = document.getElementById('denyBtn');
      btn.textContent = 'Cancelling...';
      btn.disabled = true;

      try {
        const res = await fetch('/oauth/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, action: 'deny' })
        });
        const data = await res.json();
        if (data.redirect) {
          window.location.href = data.redirect;
        } else {
          window.location.href = redirectUri + '?error=access_denied&error_description=User%20denied%20consent&state=' + encodeURIComponent(state);
        }
      } catch {
        window.location.href = redirectUri + '?error=access_denied&error_description=User%20denied%20consent&state=' + encodeURIComponent(state);
      }
    });
  </script>
</body>
</html>
    `);
  });

  /**
   * Step 1: Member Login (verifies credentials against mobile API login-pin).
   */
  router.post("/oauth/login", async (req: Request, res: Response) => {
    const { identifier, pin, state } = req.body as Record<string, string>;

    if (!state || !identifier || !pin) {
      return res.status(400).json({ success: false, error: "invalid_request", error_description: "Missing required fields" });
    }

    const pkceRaw = await appRedis.get(`${PKCE_PREFIX}${state}`);
    if (!pkceRaw) {
      return res.status(400).json({ success: false, error: "invalid_request", error_description: "Session expired. Please restart." });
    }

    try {
      const response = await axios.post(
        `${mcpConfig.apiUrl}/mobile-api/auth/login-pin`,
        { identifier: identifier.trim(), pin }
      );

      const loginData = response.data;
      const member = loginData?.data;
      const memberId = member?._id || member?.member?._id;
      if (!loginData?.success || !memberId) {
        throw new Error("Invalid credentials");
      }

      // Store authenticated session for this state
      await appRedis.setex(
        `${AUTH_SESSION_PREFIX}${state}`,
        PKCE_TTL_SEC,
        JSON.stringify({
          memberId: memberId.toString(),
          fullName: member.fullName,
          mobileNumber: member.mobileNumber
        })
      );

      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_LOGIN",
        userId: memberId.toString(),
        timestamp: new Date().toISOString()
      }), CTX);

      return res.json({
        success: true,
        member: {
          fullName: member.fullName,
          mobileNumber: member.mobileNumber
        }
      });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || "Invalid mobile number or PIN";
      return res.json({
        success: false,
        error: "access_denied",
        error_description: msg
      });
    }
  });

  /**
   * Step 2: Consent Submission (Allow or Deny).
   */
  router.post("/oauth/consent", async (req: Request, res: Response) => {
    const { state, action } = req.body as { state?: string; action?: "allow" | "deny" };

    if (!state || !action) {
      return res.status(400).json({ error: "invalid_request", error_description: "state and action are required" });
    }

    const pkceRaw = await appRedis.get(`${PKCE_PREFIX}${state}`);
    if (!pkceRaw) {
      return res.status(400).json({ error: "invalid_request", error_description: "Session expired. Please restart." });
    }
    const { codeChallenge, redirectUri, scopes } = JSON.parse(pkceRaw);

    if (action === "deny") {
      await appRedis.del(`${PKCE_PREFIX}${state}`);
      await appRedis.del(`${AUTH_SESSION_PREFIX}${state}`);

      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_CONSENT_DENIED",
        timestamp: new Date().toISOString()
      }), CTX);

      const redirectUrl = `${redirectUri}?error=access_denied&error_description=User%20denied%20consent&state=${encodeURIComponent(state)}`;
      return res.json({ redirect: redirectUrl });
    }

    // Action === "allow"
    const sessionRaw = await appRedis.get(`${AUTH_SESSION_PREFIX}${state}`);
    if (!sessionRaw) {
      return res.status(400).json({ error: "invalid_request", error_description: "Authentication session expired. Please log in again." });
    }
    const session = JSON.parse(sessionRaw);

    // Issue authorization code
    const code = await issueAuthCode(session.memberId, scopes, redirectUri, codeChallenge);

    // Cleanup temporary sessions
    await appRedis.del(`${PKCE_PREFIX}${state}`);
    await appRedis.del(`${AUTH_SESSION_PREFIX}${state}`);

    logger.info(JSON.stringify({
      event: "CHATGPT_OAUTH_CONSENT_GRANTED",
      userId: session.memberId,
      scopes,
      timestamp: new Date().toISOString()
    }), CTX);

    const redirectUrl = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    return res.json({ redirect: redirectUrl });
  });

  /**
   * Direct authorization form submission (backwards compatibility).
   */
  router.post("/oauth/authorize", async (req: Request, res: Response) => {
    const { identifier, pin, state } = req.body as Record<string, string>;

    if (!state || !identifier || !pin) {
      return res.json({ error: "invalid_request", error_description: "Missing required fields" });
    }

    const pkceRaw = await appRedis.get(`${PKCE_PREFIX}${state}`);
    if (!pkceRaw) {
      return res.json({ error: "invalid_request", error_description: "Session expired. Please restart." });
    }
    const { codeChallenge, redirectUri, scopes } = JSON.parse(pkceRaw);

    let memberId: string;
    try {
      const response = await axios.post(
        `${mcpConfig.apiUrl}/mobile-api/auth/login-pin`,
        { identifier: identifier.trim(), pin }
      );

      const loginData = response.data;
      const memberIdCandidate = loginData?.data?._id || loginData?.data?.member?._id;
      if (!loginData?.success || !memberIdCandidate) {
        throw new Error("Invalid login response from backend");
      }
      memberId = memberIdCandidate.toString();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || "Invalid credentials";
      return res.json({
        error: "access_denied",
        error_description: msg
      });
    }

    const code = await issueAuthCode(memberId, scopes, redirectUri, codeChallenge);
    await appRedis.del(`${PKCE_PREFIX}${state}`);

    logger.info(JSON.stringify({
      event: "CHATGPT_OAUTH_CONSENT_GRANTED",
      userId: memberId,
      scopes,
      timestamp: new Date().toISOString()
    }), CTX);

    const redirectUrl = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    return res.json({ redirect: redirectUrl });
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

      // PKCE verification only if code_challenge was provided during authorize
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

      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_TOKEN_ISSUED",
        userId: memberId,
        scopes,
        timestamp: new Date().toISOString()
      }), CTX);

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

        logger.info(JSON.stringify({
          event: "CHATGPT_OAUTH_TOKEN_REFRESHED",
          timestamp: new Date().toISOString()
        }), CTX);

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
      logger.info(JSON.stringify({
        event: "CHATGPT_OAUTH_TOKEN_REVOKED",
        timestamp: new Date().toISOString()
      }), CTX);
    }
    res.status(200).json({ success: true });
  });

  /**
   * Return / Callback success screen.
   */
  router.get("/oauth/callback", (req: Request, res: Response) => {
    const { error, error_description } = req.query as Record<string, string>;

    if (error) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Connection Cancelled</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;} .box{background:#1e293b;padding:32px;border-radius:12px;max-width:480px;border-left:4px solid #ef4444;box-shadow:0 10px 30px rgba(0,0,0,0.5);}</style></head>
        <body>
          <div class="box">
            <h2 style="color:#f87171;margin-top:0">Connection Not Completed</h2>
            <p style="color:#94a3b8;line-height:1.6;">${escapeHtml(error_description || "Authorization was cancelled.")}</p>
            <p style="margin-top:20px;"><a href="javascript:window.close();" style="color:#38bdf8;text-decoration:none;font-weight:600;">Close this window</a></p>
          </div>
        </body>
        </html>
      `);
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Trusted Network Connected</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .card { max-width: 520px; width: 100%; background: #1e293b; border-radius: 16px; padding: 36px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid #334155; text-align: center; }
          .badge { display: inline-block; background: #065f46; color: #34d399; padding: 6px 16px; border-radius: 9999px; font-weight: 600; font-size: 13px; margin-bottom: 20px; }
          h1 { margin: 0 0 12px 0; font-size: 24px; font-weight: 700; color: #fff; }
          p { color: #94a3b8; line-height: 1.6; margin: 0 0 28px 0; font-size: 14.5px; }
          .btn-container { display: flex; flex-direction: column; gap: 12px; }
          a.btn-main { display: block; background: linear-gradient(135deg, #10b981, #059669); color: #fff; text-decoration: none; padding: 13px; border-radius: 8px; font-weight: 600; font-size: 15px; }
          a.btn-sub { display: block; background: #090d16; border: 1px solid #334155; color: #cbd5e1; text-decoration: none; padding: 12px; border-radius: 8px; font-weight: 500; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">✓ Connected Successfully</span>
          <h1>Trusted Network is Linked to ChatGPT</h1>
          <p>Your member account has been securely authorized. You can now use conversational ChatGPT to view profile insights, search members, and publish posts.</p>

          <div class="btn-container">
            <a href="https://chatgpt.com" class="btn-main">Open ChatGPT</a>
            <a href="trustednetwork://chatgpt/connected" class="btn-sub">Return to Trusted Network App</a>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  return router;
}

function scopeDescription(scope: string): string {
  const descriptions: Record<string, string> = {
    "profile:read": "View your profile and membership details",
    "members:read": "Search verified business directory and nearby members",
    "posts:read": "View your posts and promotions",
    "posts:create": "Create business posts on your behalf",
    "posts:write": "Create and edit posts on your behalf",
    "posts:update": "Edit your existing posts",
    "posts:delete": "Delete your posts (explicit approval required)",
    "promotions:read": "View your promotions and offers",
    "promotions:create": "Create business promotions on your behalf",
    "promotions:update": "Update your business promotions",
    "promotions:delete": "Remove business promotions"
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
