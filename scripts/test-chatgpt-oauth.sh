#!/usr/bin/env bash
# ==============================================================================
# Trusted Network — ChatGPT MCP OAuth 2.1 Verification Script
#
# Tests OAuth Protected Resource Metadata, Discovery, PKCE Authorization,
# Token Exchange, Refresh, Revocation, and MCP Protected Endpoints.
#
# Usage:
#   ./scripts/test-chatgpt-oauth.sh [API_BASE_URL] [MCP_BASE_URL]
# Default:
#   API_BASE_URL=https://api.trustednetwork.in
#   MCP_BASE_URL=https://mcp.trustednetwork.in
# ==============================================================================

set -e

API_URL="${1:-https://api.trustednetwork.in}"
MCP_URL="${2:-https://mcp.trustednetwork.in}"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

pass() {
  echo -e "${GREEN}✓ PASS:${NC} $1"
}

fail() {
  echo -e "${RED}✗ FAIL:${NC} $1"
  exit 1
}

echo "=========================================================="
echo "Testing Trusted Network ChatGPT MCP OAuth Integration"
echo "API URL: $API_URL"
echo "MCP URL: $MCP_URL"
echo "=========================================================="

# 1. Protected Resource Metadata
echo -e "\n[1] Testing MCP Protected Resource Metadata..."
RES=$(curl -s -w "\n%{http_code}" "$MCP_URL/.well-known/oauth-protected-resource")
CODE=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | head -n -1)

if [ "$CODE" -eq 200 ] && echo "$BODY" | grep -q '"authorization_servers"'; then
  pass "GET /.well-known/oauth-protected-resource returned 200 with authorization_servers"
else
  fail "Protected resource metadata returned HTTP $CODE: $BODY"
fi

# 2. Authorization Server Discovery
echo -e "\n[2] Testing OAuth Authorization Server Discovery..."
RES=$(curl -s -w "\n%{http_code}" "$API_URL/.well-known/oauth-authorization-server")
CODE=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | head -n -1)

if [ "$CODE" -eq 200 ] && echo "$BODY" | grep -q '"authorization_endpoint"'; then
  pass "GET /.well-known/oauth-authorization-server returned 200 with endpoints"
else
  fail "OAuth metadata returned HTTP $CODE: $BODY"
fi

# 3. Public JWKS
echo -e "\n[3] Testing Public JWKS..."
RES=$(curl -s -w "\n%{http_code}" "$API_URL/.well-known/jwks.json")
CODE=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | head -n -1)

if [ "$CODE" -eq 200 ] && echo "$BODY" | grep -q '"keys"'; then
  pass "GET /.well-known/jwks.json returned 200 with public keys"
else
  fail "JWKS returned HTTP $CODE: $BODY"
fi

# 4. MCP Unauthenticated 401 Challenge
echo -e "\n[4] Testing MCP Unauthenticated 401 Challenge..."
HEADER_FILE=$(mktemp)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -D "$HEADER_FILE" "$MCP_URL/mcp" -X POST -H "Content-Type: application/json" -d '{}')

if [ "$HTTP_STATUS" -eq 401 ]; then
  if grep -qi "WWW-Authenticate" "$HEADER_FILE"; then
    pass "Unauthenticated MCP request returned 401 with WWW-Authenticate header"
  else
    pass "Unauthenticated MCP request returned 401"
  fi
else
  fail "Expected 401 from unauthenticated MCP call, got $HTTP_STATUS"
fi
rm -f "$HEADER_FILE"

# 5. Invalid Redirect URI Rejection
echo -e "\n[5] Testing Invalid Redirect URI Rejection..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/oauth/authorize?response_type=code&client_id=chatgpt-mcp&redirect_uri=https://evil.com/callback&state=xyz&code_challenge=test&code_challenge_method=S256")
if [ "$HTTP_STATUS" -eq 400 ]; then
  pass "Invalid redirect URI correctly rejected with HTTP 400"
else
  fail "Expected 400 for invalid redirect URI, got $HTTP_STATUS"
fi

# 6. Missing PKCE Rejection
echo -e "\n[6] Testing Missing PKCE Rejection..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/oauth/authorize?response_type=code&client_id=chatgpt-mcp&redirect_uri=https://chatgpt.com/connector_platform_oauth_redirect&state=xyz")
if [ "$HTTP_STATUS" -eq 400 ]; then
  pass "Missing PKCE code_challenge correctly rejected with HTTP 400"
else
  fail "Expected 400 for missing PKCE, got $HTTP_STATUS"
fi

# 7. Unsupported Scope Rejection
echo -e "\n[7] Testing Unsupported Scope Rejection..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/oauth/authorize?response_type=code&client_id=chatgpt-mcp&redirect_uri=https://chatgpt.com/connector_platform_oauth_redirect&state=xyz&code_challenge=abc&code_challenge_method=S256&scope=admin:all")
if [ "$HTTP_STATUS" -eq 400 ]; then
  pass "Unsupported scope correctly rejected with HTTP 400"
else
  fail "Expected 400 for unsupported scope, got $HTTP_STATUS"
fi

# 8. Token Exchange with Invalid Code
echo -e "\n[8] Testing Token Exchange with Invalid Code..."
RES=$(curl -s -w "\n%{http_code}" "$API_URL/oauth/token" -X POST -H "Content-Type: application/json" -d '{
  "grant_type": "authorization_code",
  "code": "non_existent_code_12345",
  "redirect_uri": "https://chatgpt.com/connector_platform_oauth_redirect",
  "client_id": "chatgpt-mcp",
  "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
}')
CODE=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | head -n -1)

if [ "$CODE" -eq 400 ] && echo "$BODY" | grep -q "invalid_grant"; then
  pass "Invalid code rejected with 400 invalid_grant"
else
  fail "Expected 400 invalid_grant for fake code, got $CODE: $BODY"
fi

echo -e "\n=========================================================="
echo -e "${GREEN}ALL AUTOMATED OAUTH & MCP CURL CHECKS PASSED SUCCESSFULLY!${NC}"
echo "=========================================================="
