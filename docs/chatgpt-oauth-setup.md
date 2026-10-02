# Trusted Network (CTN) ChatGPT OAuth & MCP Integration Setup

This document provides complete technical documentation for the production-ready "Connect Trusted Network with ChatGPT" integration. It covers architecture, OAuth 2.1 authorization flows, mobile endpoints, security configurations, database schemas, and deployment instructions.

---

## 1. Architecture Overview

The system strictly decouples the AI layer from internal data stores, ensuring privacy, data security, and verifiable user consent.

```
+------------------------------------+
|  Trusted Network Mobile App (CTN)  |
+-----------------+------------------+
                  |
                  | 1. GET /mobile-api/chatgpt/connect
                  v
+-----------------+------------------+
|      CTN Mobile Backend API        |
|  (https://api.trustednetwork.in)   |
+-----------------+------------------+
                  |
                  | 2. Returns short-lived OAuth connection URL
                  v
+-----------------+------------------+
|   System Browser / OAuth Server    |
|   (https://mcp.trustednetwork.in)  |
|                                    |
|   - Mobile + PIN Authentication    |
|   - Scope Consent Screen           |
|   - Grants Authorization Code      |
+-----------------+------------------+
                  |
                  | 3. Code exchange for Tokens
                  v
+-----------------+------------------+
|             ChatGPT                |
+-----------------+------------------+
                  |
                  | 4. MCP Tools over SSE / Streamable HTTP
                  v
+-----------------+------------------+
|         CTN MCP Server             |
|   (https://mcp.trustednetwork.in)  |
|                                    |
|   - Validates Bearer Token         |
|   - Enforces Scopes                |
|   - Extracts authenticatedUserId   |
+-----------------+------------------+
                  |
                  | 5. Internal API Calls with scoped CTN JWT
                  v
+-----------------+------------------+
|      CTN Internal Services         |
|   (e.g., http://127.0.0.1:5001)    |
+-----------------+------------------+
                  |
                  v
+-----------------+------------------+
|          MongoDB                   |
+------------------------------------+
```

### Key Architectural Principles
- **No Direct MongoDB Access from MCP**: MCP never accesses MongoDB directly; it operates as an authenticated API proxy to the CTN backend.
- **Identity Integrity**: User identity (`memberId`) is derived exclusively from the cryptographically verified OAuth session/grant. ChatGPT/model parameters cannot override or specify `userId`.
- **Pre-Authentication Ticket**: Mobile users already logged into CTN obtain a pre-authenticated one-time ticket (`chatgpt_preauth:<ticket>`), allowing them to bypass re-entering their mobile + PIN if the mobile session is active.
- **Explicit Write Confirmation**: Destructive or publishing actions (such as `create_post`) enforce confirmation prompts before the post is published.

---

## 2. OAuth 2.1 Specification & Flow

The authorization server complies with OAuth 2.1 with PKCE (RFC 7636) using `code_challenge_method=S256`.

### Flow Steps:
1. **Initiation**: The mobile app calls `GET /mobile-api/chatgpt/connect`. The server generates PKCE `code_verifier`, `code_challenge`, state, and a short-lived pre-auth ticket.
2. **Authorization Request**: Browser opens `https://mcp.trustednetwork.in/oauth/authorize` with:
   - `client_id=chatgpt-mcp`
   - `response_type=code`
   - `redirect_uri=https://mcp.trustednetwork.in/oauth/callback` (or configured client redirect)
   - `scope=profile:read members:read posts:read posts:create`
   - `code_challenge=<S256-hash>`
   - `code_challenge_method=S256`
   - `state=<random-state>`
   - `ticket=<optional-preauth-ticket>`
3. **Authentication**: If ticket is absent or expired, the user logs in via **Mobile Number + 4-digit PIN** using existing CTN mobile auth logic.
4. **Consent Screen**: Shows granular scopes (`profile:read`, `members:read`, `posts:read`, `posts:create`). User clicks "Allow Access".
5. **Code Issuance**: A cryptographically random authorization code is generated (10-minute TTL in Redis) bound to the `userId`, `scopes`, and `code_challenge`.
6. **Token Exchange**: ChatGPT (or OAuth client) sends `POST /oauth/token` with:
   - `grant_type=authorization_code`
   - `code=...`
   - `code_verifier=...`
   - `client_id=chatgpt-mcp`
   - `redirect_uri=...`
7. **Token Issuance**: Returns:
   - `access_token` (24-hour lifetime, stored in Redis & MongoDB `OAuthGrant`)
   - `refresh_token` (30-day lifetime)
   - `token_type=Bearer`
   - `expires_in=86400`
   - `scope=profile:read members:read posts:read posts:create`

---

## 3. Endpoints Reference

### Mobile Backend Endpoints (`https://api.trustednetwork.in`)
Requires mobile authentication header: `Authorization: Bearer <mobile-jwt>`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/mobile-api/chatgpt/connect` | Generates secure OAuth connection URL with pre-auth ticket & PKCE |
| `GET` | `/mobile-api/chatgpt/status` | Returns `{ connected: boolean, scopes: string[] }` |
| `POST` | `/mobile-api/chatgpt/disconnect` | Revokes all active tokens and grants for the user |

### OAuth Server Endpoints (`https://mcp.trustednetwork.in`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/.well-known/oauth-authorization-server` | Standard OAuth 2.1 discovery metadata |
| `GET` | `/oauth/authorize` | Authorization endpoint (renders login or consent UI) |
| `POST` | `/oauth/login` | Validates mobile number + PIN, returns consent page |
| `POST` | `/oauth/consent` | Handles user approval/denial, redirects with `code` |
| `POST` | `/oauth/token` | Exchanges authorization code or refresh token for tokens |
| `POST` | `/oauth/revoke` | Revokes an access or refresh token (RFC 7009) |
| `GET` | `/oauth/callback` | Default return screen; deep-links back to mobile app |

---

## 4. Scope System

Granular scopes are enforced by the MCP middleware:

| Scope | Description | Included in Default Flow |
|---|---|---|
| `profile:read` | View your CTN profile details, business name, and membership status | Yes |
| `members:read` | Search business directory members and view member contact info | Yes |
| `posts:read` | Read your business posts and feed updates | Yes |
| `posts:create` | Create and publish business feed posts on your behalf | Yes |
| `posts:update` | Edit your business feed posts | No (requires explicit request) |
| `posts:delete` | Delete your business posts | No (never granted by default) |
| `promotions:read` | View your active promotions | Optional |
| `promotions:create` | Create promotions for your business | Optional |

---

## 5. User Identity Binding & Post Creation

### Security Invariant: Zero Trust in Model-Provided User IDs
- The MCP `create_post` tool does NOT accept `userId` as an argument.
- When ChatGPT invokes `create_post`:
  ```json
  {
    "description": "🚀 Introducing our new AI Lead Generation feature!",
    "tags": ["AI", "LeadGen"]
  }
  ```
- The MCP handler extracts `req.mcpUser.memberId` directly from the validated Bearer token.
- MCP mints an internal short-lived CTN JWT with `memberId: req.mcpUser.memberId` and forwards the request to `POST /mobile-api/post/create-post`.

### Confirmation Step
The `create_post` tool instructions require ChatGPT to draft the post content and seek user confirmation before executing the tool call.

---

## 6. Database Entity: `OAuthGrant`

Stored in the `oauth_grants` MongoDB collection via TypeORM.

```typescript
@Entity({ name: "oauth_grants" })
@Index(["userId", "clientId"])
@Index(["accessTokenHash"])
@Index(["refreshTokenHash"])
export class OAuthGrant {
  @ObjectIdColumn()
  _id!: ObjectId;

  @Column()
  userId!: string;

  @Column()
  clientId!: string;

  @Column()
  scopes!: string[];

  @Column()
  accessTokenHash!: string;

  @Column()
  refreshTokenHash!: string;

  @Column()
  expiresAt!: Date;

  @Column({ default: false })
  isRevoked!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

Raw tokens are never stored in MongoDB. Only SHA-256 hashes (`accessTokenHash`, `refreshTokenHash`) are saved.

---

## 7. Security Audit Logging

All authentication and token lifecycle events are logged to the security audit logger without sensitive credentials (no tokens, passwords, PINs, or auth codes):

| Event | Metadata Logged |
|---|---|
| `CHATGPT_OAUTH_LOGIN` | `userId`, `mobileNumber` (masked), `clientId`, `ip` |
| `CHATGPT_OAUTH_CONSENT_GRANTED` | `userId`, `clientId`, `scopes` |
| `CHATGPT_OAUTH_CONSENT_DENIED` | `userId`, `clientId` |
| `CHATGPT_OAUTH_TOKEN_ISSUED` | `userId`, `clientId`, `scopes`, `grantType` |
| `CHATGPT_OAUTH_TOKEN_REVOKED` | `clientId`, `tokenType` |
| `CHATGPT_OAUTH_DISCONNECTED` | `userId` |

---

## 8. Environment Variables

Ensure the following variables are defined in `.env` (and configured in PM2 / deployment environment):

```env
# CTN Backend Port & URL
PORT=5001
TRUSTED_NETWORK_API_URL=http://127.0.0.1:5001

# MCP Configuration
MCP_PORT=4001
MCP_PUBLIC_URL=https://mcp.trustednetwork.in
MCP_OAUTH_TOKEN_SECRET=your-secure-mcp-oauth-token-secret-min-32-chars

# Redis & MongoDB
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
MONGO_HOST=127.0.0.1
MONGO_PORT=27017
MONGO_DATABASE=ctn
```

---

## 9. Nginx Reverse Proxy Configuration

Nginx routes both Mobile Backend (`api.trustednetwork.in`) and MCP/OAuth Server (`mcp.trustednetwork.in`).

### Nginx Configuration for `mcp.trustednetwork.in`:
```nginx
server {
    server_name mcp.trustednetwork.in;

    # MCP SSE Endpoint (disable response buffering)
    location /mcp {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # OAuth Endpoints
    location /oauth/ {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # OAuth Discovery
    location /.well-known/ {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 10. Testing & Verification

Run the test suite:
```bash
# Run all unit and integration tests for ChatGPT OAuth onboarding
npm test tests/chatgpt.oauth.onboarding.test.ts

# Run entire test suite
npm test
```

All 19 test cases in `tests/chatgpt.oauth.onboarding.test.ts` verify:
1. Generation of connection URL with valid parameters and PKCE.
2. Invalidation of unauthorized access requests.
3. Mobile + PIN login verification.
4. User consent approval and denial.
5. Authorization code issuance, 10-minute expiry, and single-use enforcement.
6. PKCE S256 verification and failure on altered verifiers.
7. Token issuance and grant persistence.
8. Expired and revoked token rejection.
9. Scope enforcement.
10. Strict user identity binding without model-controlled user IDs.
11. Safe user disconnect and Redis/DB cache clearance.
