/**
 * Cross-Platform TypeScript OAuth & MCP Verification Script.
 *
 * Runs end-to-end HTTP verification checks against a running backend and MCP instance.
 *
 * Usage:
 *   npx ts-node scripts/test-chatgpt-oauth.ts [API_URL] [MCP_URL]
 */

import axios from "axios";

const API_URL = process.argv[2] || process.env.OAUTH_ISSUER || "https://api.trustednetwork.in";
const MCP_URL = process.argv[3] || process.env.MCP_PUBLIC_URL || "https://mcp.trustednetwork.in";

const CHATGPT_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

async function run() {
  console.log("==========================================================");
  console.log("CTN ChatGPT MCP OAuth 2.1 Verification");
  console.log(`API URL: ${API_URL}`);
  console.log(`MCP URL: ${MCP_URL}`);
  console.log("==========================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name}${details ? ` -> ${details}` : ""}`);
      failed++;
    }
  }

  // 1. Protected Resource Metadata
  try {
    const res = await axios.get(`${MCP_URL}/.well-known/oauth-protected-resource`, { timeout: 5000 });
    assert(
      "Protected Resource Metadata (RFC 9449)",
      res.status === 200 &&
      res.data.resource === "https://mcp.trustednetwork.in" &&
      Array.isArray(res.data.authorization_servers) &&
      res.data.authorization_servers.includes("https://api.trustednetwork.in")
    );
  } catch (err: any) {
    assert("Protected Resource Metadata", false, err.message);
  }

  // 2. Authorization Server Metadata
  try {
    const res = await axios.get(`${API_URL}/.well-known/oauth-authorization-server`, { timeout: 5000 });
    assert(
      "Authorization Server Metadata (RFC 8414)",
      res.status === 200 &&
      res.data.issuer === "https://api.trustednetwork.in" &&
      res.data.authorization_endpoint.includes("/oauth/authorize") &&
      res.data.token_endpoint.includes("/oauth/token") &&
      res.data.code_challenge_methods_supported.includes("S256")
    );
  } catch (err: any) {
    assert("Authorization Server Metadata", false, err.message);
  }

  // 3. JWKS
  try {
    const res = await axios.get(`${API_URL}/.well-known/jwks.json`, { timeout: 5000 });
    assert(
      "Public JWKS (RFC 7517)",
      res.status === 200 && Array.isArray(res.data.keys) && res.data.keys.length > 0 && res.data.keys[0].kty === "RSA"
    );
  } catch (err: any) {
    assert("Public JWKS", false, err.message);
  }

  // 4. MCP Unauthenticated 401 Challenge
  try {
    await axios.post(`${MCP_URL}/mcp`, {}, { timeout: 5000 });
    assert("MCP Unauthenticated 401 Challenge", false, "Expected 401, but succeeded");
  } catch (err: any) {
    const status = err?.response?.status;
    const authHeader = err?.response?.headers?.["www-authenticate"];
    assert(
      "MCP Unauthenticated 401 Challenge",
      status === 401 && (!authHeader || authHeader.includes("resource_metadata"))
    );
  }

  // 5. Invalid Redirect URI Rejection
  try {
    await axios.get(`${API_URL}/oauth/authorize`, {
      params: {
        response_type: "code",
        client_id: "chatgpt-mcp",
        redirect_uri: "https://evil-hacker.com/callback",
        state: "test_state",
        code_challenge: "abc",
        code_challenge_method: "S256"
      },
      timeout: 5000
    });
    assert("Invalid Redirect URI Rejection", false, "Expected 400");
  } catch (err: any) {
    assert("Invalid Redirect URI Rejection", err?.response?.status === 400);
  }

  // 6. Missing PKCE Rejection
  try {
    await axios.get(`${API_URL}/oauth/authorize`, {
      params: {
        response_type: "code",
        client_id: "chatgpt-mcp",
        redirect_uri: CHATGPT_REDIRECT_URI,
        state: "test_state"
      },
      timeout: 5000
    });
    assert("Missing PKCE Rejection", false, "Expected 400");
  } catch (err: any) {
    assert("Missing PKCE Rejection", err?.response?.status === 400);
  }

  // 7. Token exchange with fake code
  try {
    await axios.post(`${API_URL}/oauth/token`, {
      grant_type: "authorization_code",
      code: "invalid_code_12345",
      redirect_uri: CHATGPT_REDIRECT_URI,
      client_id: "chatgpt-mcp",
      code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    }, { timeout: 5000 });
    assert("Invalid Code Token Exchange", false, "Expected 400");
  } catch (err: any) {
    assert("Invalid Code Token Exchange", err?.response?.status === 400 && err?.response?.data?.error === "invalid_grant");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
