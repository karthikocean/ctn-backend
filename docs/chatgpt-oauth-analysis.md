# Trusted Network — ChatGPT OAuth Integration Analysis

> **Document**: Technical Analysis for Mobile-Initiated ChatGPT OAuth Onboarding Flow  
> **Date**: 2026-10-02  
> **Target System**: CTN Backend (Node.js / Express / TypeScript / TypeORM / MongoDB / Redis)  
> **Scope**: Implementation of a production-ready "Connect Trusted Network with ChatGPT" onboarding flow.

---

## 1. Existing Mobile Authentication Flow

Mobile authentication in Trusted Network operates via two primary mechanisms:

1. **OTP-Based Flow**:
   - `POST /mobile-api/auth/send-otp`: Member enters phone or email. System validates non-blocked state, generates a cryptographically secure 4-digit OTP via `generateSecureOtp()`, saves it to the `Verification` collection, and transmits it via SMS (`sendOTPSMS`) or Email (`MailService`).
   - `POST /mobile-api/auth/verify-otp`: Member submits OTP. Verification record is matched and invalidated. Returns JWT `accessToken` with 30-day default expiry and persists session in the `UserToken` collection.

2. **PIN-Based Flow (`/mobile-api/auth/login-pin`)**:
   - Controller: `MobileAuthController.loginWithPin` in `src/controllers/mobile/AuthController.ts`.
   - Endpoint: `POST /mobile-api/auth/login-pin`.
   - Request DTO: `MobileLoginDto` (`identifier`: email or mobileNumber, `pin`: string).
   - Validation:
     - Fetches member matching `{ $or: [{ email: identifier }, { mobileNumber: identifier }], isDeleted: false }`.
     - Checks `member.status !== MemberStatus.BLOCKED`.
     - Validates configured PIN using `bcrypt.compare(pin, member.pin)`.
     - Updates `lastLoggedIn = new Date()`, activates `INACTIVE` members to `ACTIVE`.
     - Issues JWT signed with `JWT_SECRET`, rotates/creates session record in `UserToken` collection, and returns member metadata.

---

## 2. Existing User/Member Identity Model

The central entity is `Member` (`src/entity/Member.ts`), backed by MongoDB collection `members`:
- **Identity Key**: `_id: ObjectId` (MongoDB 24-character hexadecimal ObjectId).
- **Core Fields**:
  - `fullName: string`
  - `mobileNumber: string` (unique index)
  - `email: string` (optional, unique index)
  - `pin: string` (bcrypt-hashed 4-to-6 digit PIN)
  - `status: MemberStatus` (`"active"` | `"inactive"` | `"blocked"` | `"suspended"`)
  - `isDeleted: boolean`
  - `fcmToken?: string`
  - `stateId?: ObjectId`, `regionAreaId?: ObjectId`, `businessCategoryId?: ObjectId`
  - `purchased: boolean`, `subscriptionStatus: string`
- **Ownership Model**:
  - Every resource created by a member (Posts, Products, Slips, etc.) references `memberId: ObjectId` or `userId: ObjectId`.
  - In requests processed by `MobileAuthMiddleware`, `req.user` is populated with:
    `{ userId: string, id: string, userType: "MEMBER" }`.

---

## 3. Existing Token Implementation

Trusted Network utilizes a two-tier token architecture:

### A. Mobile Application JWT (`JWT_SECRET`)
- **Format**: Signed JWT (`jsonwebtoken`).
- **Payload**: `{ userId: string, userType: "MEMBER" }`.
- **Secret**: `process.env.JWT_SECRET`.
- **Lifetime**: `process.env.JWT_EXPIRES_IN` (default `30d`).
- **Storage**: MongoDB collection `user_tokens` (`UserToken` entity: `{ userId: ObjectId, token: string, createdAt, updatedAt }`). One active token per user by default.
- **Cache Layer**: Redis key `auth:v1:${sha256(token)}` caches `{ userId, status, isDeleted, tokenRecordExists }` with 300s (5-minute) TTL.
- **Validation**: `MobileAuthMiddleware` (`src/middlewares/MobileAuthMiddleware.ts`):
  1. Checks Redis cache `auth:v1:${hash}`. On cache hit, attaches `req.user` in <1ms without DB lookup.
  2. On cache miss, queries `user_tokens` and `members` in parallel using `Promise.all`.
  3. Supports MCP OAuth token fallback: if `JWT_SECRET` verification fails, attempts verification with `MCP_OAUTH_TOKEN_SECRET` and maps `memberId` to `userId`.

### B. MCP OAuth 2.1 Tokens (`MCP_OAUTH_TOKEN_SECRET`)
- **Format**: Signed JWT (`jsonwebtoken`).
- **Payload**: `{ jti: string, memberId: string, scopes: string[], type: "access" | "refresh" }`.
- **Secret**: `process.env.MCP_OAUTH_TOKEN_SECRET` (distinct from `JWT_SECRET`).
- **Lifetime**: Access tokens: 1 hour (`3600s`); Refresh tokens: 30 days (`2592000s`).
- **Session Store**: Redis keys:
  - `mcp:access:${jti}` -> `{ memberId, scopes }`
  - `mcp:refresh:${jti}` -> `{ memberId, scopes, accessJti }`
  - `auth:v1:${sha256(accessToken)}` -> pre-seeded for immediate `MobileAuthMiddleware` acceptance.

---

## 4. Existing MCP Architecture

The Model Context Protocol (MCP) server runs as an independent, isolated service:

```
[ ChatGPT / LLM Client ]
          │  HTTPS / StreamableHTTP
          ▼
    [ Nginx Reverse Proxy ] (api.trustednetwork.in)
     ├── /mcp          ──> 127.0.0.1:4001 (ctn-mcp process)
     ├── /oauth        ──> 127.0.0.1:4001 (ctn-mcp process)
     └── /mobile-api   ──> 127.0.0.1:5001 (ctn-backend process)
          │
    [ MCP Server (Port 4001) ]
     ├── OAuth Router (RFC 8414 metadata, /oauth/authorize, /oauth/token, /oauth/revoke)
     ├── McpServer (Tools: profile, members, posts)
     └── API Proxy Service (src/mcp/services/api.ts)
          │
          │ Internal loopback HTTP requests with short-lived internal JWT
          ▼
    [ CTN Mobile Backend (Port 5001) ]
     ├── MobileAuthMiddleware (validates token against Redis / JWT_SECRET / MCP secret)
     ├── Controllers (/mobile-api/members, /mobile-api/posts, etc.)
     └── TypeORM / MongoDB / Redis (Source of Truth)
```

**Key Isolation Invariant**:
- The MCP server does **NOT** connect directly to MongoDB collections for data manipulation.
- All operations are strictly proxied to existing `/mobile-api` endpoints via internal HTTP loopback (`TRUSTED_NETWORK_API_URL=http://127.0.0.1:5001`).
- The `memberId` is injected strictly from the authenticated OAuth token session, preventing any model-controlled identity spoofing.

---

## 5. Existing MCP Authentication

- **Discovery Endpoint**: `GET /.well-known/oauth-authorization-server` (RFC 8414).
- **Authorization Endpoint**: `GET /oauth/authorize` & `POST /oauth/authorize`.
  - Supports RFC 7636 PKCE (`code_challenge` + `code_challenge_method=S256`) and standard Authorization Code grant.
  - Form prompts member for Mobile Number and PIN, authenticates via `POST /mobile-api/auth/login-pin`, issues single-use 5-minute authorization code stored in Redis (`mcp:code:${code}`).
- **Token Endpoint**: `POST /oauth/token`.
  - Accepts `grant_type=authorization_code` and `grant_type=refresh_token`.
  - Enforces single-use authorization code consumption.
  - Verifies PKCE verifier if code challenge was registered.
  - Issues access token and refresh token, stored in Redis.
- **Revocation Endpoint**: `POST /oauth/revoke` (RFC 7009).
  - Deletes session from Redis.

---

## 6. Existing MCP Endpoints

| Protocol Endpoint | Method | Path | Description |
|---|---|---|---|
| RFC 8414 Metadata | `GET` | `/.well-known/oauth-authorization-server` | Advertises endpoints, scopes, grant types |
| OAuth Authorize | `GET`, `POST` | `/oauth/authorize` | Member authentication and consent |
| OAuth Token | `POST` | `/oauth/token` | Code-for-token exchange |
| OAuth Revoke | `POST` | `/oauth/revoke` | Token revocation |
| MCP Protocol | `POST`, `GET`, `DELETE` | `/mcp` | StreamableHTTP transport for LLM tool interaction |
| Health Check | `GET` | `/health` | MCP server process health check |

---

## 7. Existing Available MCP Tools

All registered in `src/mcp/tools/`:

| Tool Name | File | Description | Scope Required |
|---|---|---|---|
| `get_my_profile` | `profile.ts` | Retrieve authenticated member's profile, subscription & stats | `profile:read` |
| `get_my_posts` | `posts.ts` | Retrieve authenticated member's posts and promotions | `posts:read` |
| `get_post` | `posts.ts` | Retrieve single post by 24-character ObjectId | `posts:read` |
| `create_post` | `posts.ts` | Create post/promotion (`PROMOTION`, `GIVE`, `ASK`, `REQUIREMENT`) | `posts:write` / `posts:create` |
| `edit_post` | `posts.ts` | Edit an existing post owned by the member | `posts:write` / `posts:update` |
| `delete_post` | `posts.ts` | Soft-delete a post owned by the member | `posts:write` / `posts:delete` |
| `search_members` | `members.ts` | Search verified directory by name, category, or location | `members:read` |
| `get_nearby_members` | `members.ts` | Find members nearby given coordinates and radius | `members:read` |
| `get_member` | `members.ts` | Get public profile of another member | `members:read` |

---

## 8. Existing Post APIs and Services

Controller: `PostController` (`src/controllers/mobile/PostController.ts`):
- `POST /mobile-api/posts/`:
  - Body: `CreatePostDto` (`type`, `title`, `description`, `location`, `period`, `media`, `requirementVisibility`, `stateIds`, `regionIds`, `categoryIds`).
  - Auth: Injects `memberId = req.user.userId`.
  - Behavior: Post is created with `isActive: true, isDeleted: false`. Immediately active on network.
- `GET /mobile-api/posts/my-posts`:
  - Query: `type`, `page`, `limit`.
  - Filters by authenticated `memberId`.
- `PUT /mobile-api/posts/:id`:
  - Checks ownership (`post.memberId.toString() === req.user.userId`).
- `DELETE /mobile-api/posts/:id`:
  - Soft delete (`isDeleted: true`).

**Promotions**:
- In Trusted Network, promotions are **NOT** a separate database entity.
- A promotion is simply a `Post` where `type === "PROMOTION"`.

---

## 9. Existing Permission and Role Implementation

- Mobile members are end-users with `userType: "MEMBER"`.
- Member authorizations are scope-based and ownership-based:
  - Members can only modify or delete resources where `resource.memberId === req.user.userId`.
  - Feature access is regulated by subscriptions (`SubscriptionFeatureGuard`, `MemberSubscription`).
- Admin permissions are stored in `roles` (`src/entity/Role.Permission.ts`) with module/action matrices. MCP tools strictly proxy to mobile endpoints, so admin privileges are never exposed through MCP.

---

## 10. Recommended Integration Points for Mobile Onboarding

To enable the seamless mobile flow where tapping **"Connect with ChatGPT"** in the CTN mobile app automatically initiates authorization:

1. **New Mobile Controller**: `src/controllers/mobile/ChatGptController.ts`:
   - Prefix: `/mobile-api/chatgpt` (auto-registered via routing-controllers).
   - Middleware: `@UseBefore(MobileAuthMiddleware)` (guarantees member is authenticated in the mobile app).
   - Endpoints:
     - `GET /mobile-api/chatgpt/connect`: Generates a cryptographically signed, short-lived authorization ticket (5-min TTL) bound to `req.user.userId`, and constructs the connection URL pointing to the OAuth authorization server.
     - `GET /mobile-api/chatgpt/status`: Checks if the member has an active, unrevoked ChatGPT OAuth connection in the database / Redis.
     - `POST /mobile-api/chatgpt/disconnect`: Revokes all active tokens, grants, and Redis sessions for this member.

2. **Persistent OAuth Grant Entity**: `src/entity/OAuthGrant.ts`:
   - Collection: `oauth_grants`
   - Fields: `userId`, `clientId`, `scopes`, `authorizationCodeHash`, `accessTokenHash`, `refreshTokenHash`, `isRevoked`, `revokedAt`, `expiresAt`, `createdAt`, `updatedAt`.
   - Indexed on `userId`, `clientId`, and token hashes.

3. **Consent & Return Screen**:
   - Update `GET /oauth/authorize` to display a branded, clear consent screen detailing granted scopes:
     - View profile (`profile:read`)
     - Search business members (`members:read`)
     - View posts (`posts:read`)
     - Create posts (`posts:create` / `posts:write`)
   - If user authenticates from mobile or has an active pre-auth ticket, they can review permissions and click **"Allow Access"**.
   - Upon completion, displays a confirmation screen with a clean return button / universal link to return to the app or open ChatGPT.

4. **Audit Logging**:
   - Centralized security audit logger for OAuth lifecycle events:
     - `CHATGPT_OAUTH_CONNECT_INITIATED`
     - `CHATGPT_OAUTH_LOGIN`
     - `CHATGPT_OAUTH_CONSENT_GRANTED`
     - `CHATGPT_OAUTH_CONSENT_DENIED`
     - `CHATGPT_OAUTH_TOKEN_ISSUED`
     - `CHATGPT_OAUTH_TOKEN_REVOKED`
     - `CHATGPT_OAUTH_DISCONNECTED`
   - Zero sensitive parameters (no PINs, raw tokens, or client secrets) written to logs.
