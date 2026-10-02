# Trusted Network — ChatGPT MCP Integration Analysis

> **Status**: Phase 1 Analysis — STOP POINT (no code written yet)
> **Date**: 2026-10-02
> **Purpose**: Full inspection of the existing backend before any MCP implementation begins.

---

## A. Existing Authentication Flow

### Mobile Authentication (JWT + Session Token)

```
Mobile App
  POST /mobile-api/auth/send-otp { identifier, type:"email"|"phone" }
    -> generates 4-digit OTP, saves to Verification collection, sends via SMS/email
  POST /mobile-api/auth/verify-otp  { identifier, type, otp, fcmToken? }
    -> verifies OTP, creates JWT, saves token to UserToken collection
  <- accessToken (JWT, 30d expiry by default)

  OR

  POST /mobile-api/auth/login-pin { identifier, pin }
    -> bcrypt.compare(pin, member.pin), creates JWT, saves token to UserToken
  <- accessToken

Subsequent authenticated requests:
  Authorization: Bearer <accessToken>
    MobileAuthMiddleware runs on every protected route:
      1. Decode JWT locally (jwt.verify, JWT_SECRET env)
      2. Extract decoded.userId
      3. Redis cache lookup -> cache HIT: skip DB, attach req.user
      4. Cache MISS -> parallel DB fetch:
           UserToken.findOneBy({ userId, token })
           Member.findOneBy({ _id, isDeleted: false })
      5. Token not found in DB -> 405 "Session expired"
      6. Member INACTIVE/BLOCKED -> 401
      7. Token expired -> rotate token, return x-new-token header
      8. Populate Redis cache (5-min TTL)
      9. Set req.user = { userId, id, userType:"MEMBER" }
```

**JWT Payload**: `{ "userId": "<member ObjectId string>", "userType": "MEMBER" }`

**JWT_SECRET**: env `JWT_SECRET`

**JWT_EXPIRES_IN**: env `JWT_EXPIRES_IN` (default `30d`)

**Session Store**: MongoDB `user_tokens` collection, one token per member.

**Cache**: Redis. Key = SHA-256(token). TTL = 5 min.

**Logout**: `POST /mobile-api/auth/logout` — deletes token from DB, calls `invalidateAuthCache(token)`.

---

## B. Existing Mobile API Capability Map

Route prefix: `/mobile-api`

### Authentication (`/auth`)

| Capability | Method | Route | Auth Required |
|---|---|---|---|
| Send OTP (email or phone) | POST | `/auth/send-otp` | No |
| Verify OTP + Login | POST | `/auth/verify-otp` | No |
| Login with PIN | POST | `/auth/login-pin` | No |
| Reset PIN | POST | `/auth/reset-pin` | Yes |
| Change PIN | POST | `/auth/change-pin` | Yes |
| Logout (current device) | POST | `/auth/logout` | Yes |
| Logout all devices | POST | `/auth/logout-all` | Yes |

### Member Management (`/members`)

| Capability | Method | Route | Notes |
|---|---|---|---|
| Register | POST | `/members/register` | No auth |
| Set PIN (first time) | POST | `/members/set-pin` | No auth |
| Verify PIN | POST | `/members/verify-pin` | No auth |
| Get my profile | GET | `/members/profile` | Yes — subscription, category, region, stats |
| Update my profile | PUT | `/members/profile` | Yes |
| Delete my profile | DELETE | `/members/profile` | Yes (soft delete) |
| Update GPS location | PUT | `/members/location` | Yes |
| Update FCM token | PUT | `/members/fcm-token` | Yes |
| Check location match | POST | `/members/check-location` | Yes |
| Get member suggestions | GET | `/members/suggestions` | Yes |
| Follow-back suggestions | GET | `/members/follow-back-suggestions` | Yes |
| Member directory | GET | `/members/` | Yes — `?search=&city=&category=&state=&region=&page=&limit=` |
| Get nearby members | GET | `/members/nearby` | Yes — `?lat=&lng=&radius=(5\|10)&page=&limit=` |
| Daily recap lists | GET | `/members/recap-lists` | Yes |
| Reported members list | GET | `/members/reported-members` | Yes |
| Get member detail | GET | `/members/:id` | Yes — posts, stats, connection status |
| Report a member | POST | `/members/:id/report` | Yes |
| Unreport a member | POST | `/members/:id/unreport` | Yes |

### Posts (`/posts`) — controller-level auth via `MobileAuthMiddleware`

Post types: `PROMOTION`, `GIVE`, `ASK`, `REQUIREMENT`

| Capability | Method | Route | Notes |
|---|---|---|---|
| Get daily post limits | GET | `/posts/daily-counts` | Yes |
| Create post | POST | `/posts/` | Yes — type required |
| Get my posts | GET | `/posts/my-posts` | Yes — `?type=&page=&limit=` |
| Get following posts | GET | `/posts/following-posts` | Yes |
| Get region requirements | GET | `/posts/region-requirements` | Yes |
| Get overall posts | GET | `/posts/overall` | Yes — PROMOTION, no region restriction |
| Get region posts | GET | `/posts/region` | Yes — ASK/PROMOTION for your region |
| Get all posts (full feed) | GET | `/posts/` | Yes — complex visibility rules |
| Get post by ID | GET | `/posts/:id` | Yes |
| Update post | PUT | `/posts/:id` | Yes — owner only |
| Delete post | DELETE | `/posts/:id` | Yes — owner only, soft delete |
| Share post to chat | POST | `/posts/:id/share` | Yes |
| Save post | POST | `/posts/:id/save` | Yes |
| Unsave post | POST | `/posts/:id/unsave` | Yes |
| Get saved posts | GET | `/posts/saved/list` | Yes |
| Report post | POST | `/posts/:id/report` | Yes |
| Respond to post | POST | `/posts/:id/respond` | Yes |

### Media (`/media`)

| Capability | Method | Route | Notes |
|---|---|---|---|
| Upload file(s) to S3 | POST | `/media/upload` | No auth, upload limiter — `?folder=` |
| Get public S3 URL | GET | `/media/view` | No auth — `?file=<relativePath>` |
| Get private pre-signed URL | GET | `/media/private-view` | No auth — 1hr expiry |
| Delete file from S3 | DELETE | `/media/` | No auth |

### Other Mobile Controllers (summary)

| Area | Key routes |
|---|---|
| Connections | follow, unfollow, accept, reject, block |
| Chat | conversations, messages, send, read |
| Announcements | list, book, respond |
| Spotlights | list, request, view |
| Subscriptions | plans, create-order, verify-payment |
| Trainings | list, enroll, progress |
| Milestones | list, create, view |
| Points | balance, history, leaderboard |
| Referrals | list, generate, validate |
| Lead Generation | AI-powered lead matching |

---

## C. Database Models (TypeORM + MongoDB)

ORM: TypeORM with MongoDB driver. Database: MongoDB (`MONGO_URI` env).

### Member (collection: `members`)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `fullName` | string | Required |
| `mobileNumber` | string | Required, indexed |
| `email` | string | Optional, indexed |
| `pin` | string | Bcrypt-hashed, excluded from serialization |
| `profilePhoto` | string | S3 relative path |
| `profileBanner` | string | S3 relative path |
| `about` | string | Optional |
| `membershipType` | string | Default `BASIC` |
| `businessName` | string | |
| `businessType` | string | |
| `legalName` | string | |
| `businessCategory` | ObjectId | Ref to Category |
| `subCategory` | ObjectId | Ref to Category |
| `industry` | string | |
| `yearsOfExperience` | number | |
| `companySize` | string | |
| `gstNumber` | string | |
| `state` | string | |
| `city` | string | |
| `businessAddress` | string | |
| `businessRegion` | ObjectId | Ref to BusinessRegion area |
| `serviceLocations` | json | `{ country, states[], cities[] }` |
| `productsServices` | json[] | `{ title, image, description }[]` |
| `workImages` | string[] | S3 relative paths |
| `certifications` | string[] | S3 relative paths |
| `businessDocuments` | string[] | S3 relative paths |
| `websiteUrl` | string | |
| `linkedinProfile` | string | |
| `instagram` | string | |
| `facebook` | string | |
| `youtubeLink` | string | |
| `status` | enum | `active`, `inactive`, `blocked` |
| `isDeleted` | boolean | Soft delete flag |
| `planId` | ObjectId | Ref to Plan |
| `subscriptionId` | ObjectId | Ref to MemberSubscription |
| `fcmToken` | string | FCM push token (excluded from serialization) |
| `points` | number | Gamification points |
| `dailyScore` | number | |
| `isOnline` | boolean | Socket.IO presence |
| `lastSeen` | Date | |
| `lastLoggedIn` | Date | |
| `latitude` / `longitude` | number | GPS coordinates |
| `locationVisibility` | enum | `EVERYONE`, `FOLLOWERS`, `MUTUAL` |
| `dob` | Date | Date of birth |
| `referralCode` | string | Unique, sparse indexed |
| `createdAt` / `updatedAt` | Date | |

### PostModel (collection: `posts`)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `type` | enum | `PROMOTION`, `GIVE`, `ASK`, `REQUIREMENT` |
| `title` | string | Required |
| `description` | string | Required |
| `location` | string | Optional |
| `period` | string | Optional |
| `media` | string[] | S3 relative paths |
| `memberId` | ObjectId | Owner (ref to Member) |
| `responsedCount` | number | |
| `sharedCount` | number | |
| `stateIds` | ObjectId[] | Ref to State |
| `regionIds` | ObjectId[] | Ref to BusinessRegion |
| `categoryIds` | ObjectId[] | Ref to Category |
| `subCategoryIds` | ObjectId[] | Ref to Category |
| `isDeleted` | boolean | Soft delete |
| `isActive` | boolean | |
| `status` | string | `active`, `reported` |
| `requirementVisibility` | enum | `MUTUAL-FRIEND`, `REGION`, `OVERALL` |
| `createdAt` / `updatedAt` | Date | |

### Category (collection: `categories`)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | string | Unique per type |
| `type` | enum | `MAIN`, `SUB`, `REFERRAL` |
| `parentCategory` | ObjectId | For sub-categories |
| `referralParent` | ObjectId | For referral mapping |
| `status` | enum | `active`, `inactive` |
| `isDeleted` | boolean | |

### Connection (collection: `connections`)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `senderId` | ObjectId | Initiator / follower |
| `receiverId` | ObjectId | Followed member |
| `status` | enum | `PENDING`, `ACCEPTED`, `BLOCKED` |
| `isDeleted` | boolean | |

### UserToken (collection: `user_tokens`)

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | Ref to Member |
| `token` | string | Current JWT (one per member) |

### Other Key Entities

| Entity | Purpose |
|---|---|
| `Announcement` | Scheduled events |
| `BusinessRegion` | Hierarchical region structure |
| `Conversation` | Chat conversations |
| `Message` | Chat messages |
| `MemberSubscription` | Active subscription state |
| `Plan` | Subscription plans |
| `Payment` | Payment records |
| `Referral` | Peer referrals |
| `ThankYouSlip` | Business done acknowledgements |
| `OneToOne` | Direct meeting records |
| `Milestone` | Achievement posts |
| `Spotlight` | Featured member slots |
| `Training` | Learning modules |
| `PointConfig` | Points rules |
| `PointHistory` | Points earned/spent log |
| `PushNotifications` | FCM notification records |
| `RequestLog` | Full API request/response audit log |
| `Verification` | OTP records |
| `Reminder` | Personal reminders |

---

## D. Existing Authorization Rules

### User Identity

- Identity established entirely via JWT.
- `req.user.userId` = member MongoDB ObjectId string.
- Set by `MobileAuthMiddleware` after JWT verification + DB/cache validation.
- **Never set by any request body or query parameter.**

### JWT Validation Steps

1. `jwt.verify(token, JWT_SECRET)` — signature + expiry
2. Redis cache lookup (5-min TTL) — cache hit skips DB
3. DB lookup: `UserToken` (token must exist) + `Member` (active, not deleted)
4. Expired token → token rotation (new token in `x-new-token` header)

### Ownership Checks

- Posts: `post.memberId.toString() !== userId` → 403
- Profile: `req.user.userId` always used — never from request body
- Connections: direction-aware (sender vs receiver roles)

### Admin Permissions

- Separate `AdminUser` entity + `AuthMiddleware` (different from `MobileAuthMiddleware`)
- Admin prefix: `/api/admin`
- **Admin APIs must never be exposed via MCP.**

### Location Visibility

Enforced in `getNearbyMembers`:
- `EVERYONE` — visible to all
- `FOLLOWERS` — visible only to members you follow
- `MUTUAL` — visible only to mutual follows

---

## E. Existing Upload Architecture

### Upload Endpoint

```
POST /mobile-api/media/upload?folder=<folderName>
Content-Type: multipart/form-data
Field name: files (single or multiple)
```

No authentication required at route level, but `uploadLimiter` is applied.

### Storage

- **Provider**: AWS S3
- **Bucket**: `AWS_S3_BUCKET_NAME` env
- **Region**: `AWS_REGION` env (default `ap-south-1`)
- **Key format**: `<folder>/media-<timestamp>-<random>.<ext>`
- **Database storage**: Only the relative path is stored in MongoDB (e.g., `/posts/media-xxx.jpg`)
- **Public URL**: `AWS_S3_BASE_URL/<relative path>` via `GET /media/view?file=<path>`
- **Private URL**: Pre-signed — `GET /media/private-view?file=<path>` — 1-hour expiry

### Validation

| Constraint | Value |
|---|---|
| Max file size per file | 20 MB |
| Global body limit | 50 MB (express-fileupload) |
| Field name | Must be `files` |
| MIME type validation | Not explicitly restricted at endpoint level |

### Upload Service Methods

- `uploadToS3(key, buffer, mimetype)` — PutObjectCommand
- `getFileUrl(relativePath)` — returns `AWS_S3_BASE_URL + path`
- `getPrivateFileUrl(relativePath, expiresIn)` — presigned URL
- `deleteFromS3(relativePath)` — DeleteObjectCommand
- `cleanupFiles(paths[])` — batch delete
- `cleanupReplacedFiles(old, new)` — diff-based cleanup

---

## F. Rate Limiting (existing)

| Limiter | Applies to | Store |
|---|---|---|
| `mobileApiLimiter` | `/mobile-api/*` | Redis |
| `adminApiLimiter` | `/api/admin/*` | Redis |
| `apiLimiter` | `/api/*` (non-admin) | Redis |
| `otpLimiter` | OTP endpoints | Redis |
| `authLimiter` | Login endpoints | Redis |
| `uploadLimiter` | Upload endpoints | Redis |
| `paymentLimiter` | Payment endpoints | Redis |
| `searchLimiter` | Available, not applied globally | Redis |

Key generator: `userOrIpKey` — authenticated user ID, or IP as fallback.

---

## G. Infrastructure and Deployment

### Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js >= 20.11 |
| Language | TypeScript (CommonJS) |
| Framework | Express.js + routing-controllers |
| Database | MongoDB via TypeORM |
| Cache | Redis (ioredis) |
| Queue | BullMQ |
| Real-time | Socket.IO |
| Storage | AWS S3 |
| Notifications | Firebase FCM |
| Email | ZeptoMail (SMTP) |
| Payments | Razorpay |
| AI | OpenAI / Google Gemini |
| Process Manager | PM2 (fork mode, 1 instance) |

### PM2 Configuration (ecosystem.config.js)

```js
{
  name: 'ctn-backend',
  script: 'dist/index.js',
  exec_mode: 'fork',
  instances: 1,
  max_memory_restart: '3G'
}
```

### Ports and Route Prefixes

| Prefix | Purpose |
|---|---|
| `/mobile-api` | Mobile app APIs |
| `/api/admin` | Admin panel APIs |
| `/website-api` | Website APIs |
| `/api` | General/shared APIs |
| `/api/health` | Health check |
| `/api-docs` | Swagger UI (dev only) |

Default port: `PORT=4000` (configurable via env).

---

## H. Key Findings for MCP Design

### What EXISTS and can be mapped to MCP tools

| MCP Tool | Backend Route | Notes |
|---|---|---|
| `get_my_profile` | `GET /mobile-api/members/profile` | Full profile + subscription + stats |
| `search_members` | `GET /mobile-api/members/` | `?search=&category=&city=&state=` |
| `get_nearby_members` | `GET /mobile-api/members/nearby` | `?lat=&lng=&radius=(5\|10)` |
| `get_member` | `GET /mobile-api/members/:id` | Public member detail |
| `get_my_posts` | `GET /mobile-api/posts/my-posts` | `?type=&page=&limit=` |
| `get_post` | `GET /mobile-api/posts/:id` | Single post detail |
| `create_post` | `POST /mobile-api/posts/` | All 4 post types |
| `edit_post` | `PUT /mobile-api/posts/:id` | Owner only |
| `delete_post` | `DELETE /mobile-api/posts/:id` | Owner only, soft delete |

### CRITICAL: No separate Promotion entity exists

> **Promotions in Trusted Network = Posts with `type: "PROMOTION"`**

There is no:
- `createPromotion()` service or separate collection
- `publishPromotion()` endpoint
- Draft/publish lifecycle for posts
- `Promotion` entity

**All post content is immediately active when created.**

### Missing Capabilities (not currently in backend)

| Requested Capability | Status | Recommended Action |
|---|---|---|
| `get_my_promotions` (separate) | Not available | Use `get_my_posts?type=PROMOTION` |
| `create_promotion` (separate entity) | Not available | Use `create_post` with `type:PROMOTION` |
| `publish_promotion` (draft->publish) | **Not available** | Add draft state to Post if needed |
| `edit_promotion` | Not available | Use `edit_post` |
| `delete_promotion` | Not available | Use `delete_post` |
| `upload_image` via MCP | Not feasible via text protocol | Deferred |
| Idempotency keys for create | Not available | Implement in MCP layer or add to backend |

### If draft/publish promotion workflow is required

Minimal additive backend change:
- Add `PostStatus` enum: `DRAFT | PUBLISHED`
- Add `publishedAt: Date` field to `PostModel`
- Add `PATCH /mobile-api/posts/:id/publish` endpoint
- This is additive-only — no existing functionality changes

---

## I. Proposed MCP Architecture

```
ChatGPT
    | OAuth 2.1 (Authorization Code + PKCE S256)
    | MCP access token
    v
MCP Server (src/mcp/)
    | resolve member identity from OAuth token
    | internal HTTP call to existing /mobile-api routes
    v
Trusted Network API (existing mobile-api routes)
    |
    v
MongoDB (via TypeORM)
```

### Proposed MCP Tool Set (9 tools based on actual backend)

| # | Tool | Maps to | OAuth Scope |
|---|---|---|---|
| 1 | `get_my_profile` | `GET /mobile-api/members/profile` | `profile:read` |
| 2 | `search_members` | `GET /mobile-api/members/` | `members:read` |
| 3 | `get_nearby_members` | `GET /mobile-api/members/nearby` | `members:read` |
| 4 | `get_member` | `GET /mobile-api/members/:id` | `members:read` |
| 5 | `get_my_posts` | `GET /mobile-api/posts/my-posts` | `posts:read` |
| 6 | `get_post` | `GET /mobile-api/posts/:id` | `posts:read` |
| 7 | `create_post` | `POST /mobile-api/posts/` | `posts:write` |
| 8 | `edit_post` | `PUT /mobile-api/posts/:id` | `posts:write` |
| 9 | `delete_post` | `DELETE /mobile-api/posts/:id` | `posts:write` |

### Tools NOT Feasible

| Tool | Reason |
|---|---|
| `publish_promotion` | No draft state in Post entity |
| `create_promotion` as separate entity | No Promotion entity |
| `upload_image` | Requires multipart — MCP is text-based |

### Proposed File Structure

```
src/
  mcp/
    server.ts            MCP server initialization
    index.ts             Isolated MCP process entry point
    config.ts            MCP env config reader
    auth/
      oauth.ts           OAuth 2.1 endpoints (authorize, token, well-known)
      token.ts           Token issuance, validation, revocation
    tools/
      profile.ts         get_my_profile
      members.ts         search_members, get_nearby_members, get_member
      posts.ts           get_my_posts, get_post, create_post, edit_post, delete_post
    services/
      api.ts             Internal HTTP client calling existing mobile-api routes
    middleware/
      authentication.ts  MCP request auth (OAuth token validation)
      authorization.ts   Scope validation per tool
    utils/
      errors.ts          Safe error mapping (never expose internals)
      logging.ts         Audit logging (no tokens/secrets in logs)
      rateLimit.ts       MCP-specific rate limiters
```

---

## J. Environment Variables Required for MCP

```ini
# MCP Feature Flag
MCP_ENABLED=false
MCP_PORT=4001

# Public URL (for OAuth redirect URIs and well-known metadata)
MCP_PUBLIC_URL=https://mcp.trustednetwork.in

# OAuth configuration (separate from existing JWT_SECRET)
MCP_OAUTH_ISSUER=https://mcp.trustednetwork.in
MCP_OAUTH_AUDIENCE=trusted-network-mcp
MCP_OAUTH_TOKEN_SECRET=<new separate secret - NOT JWT_SECRET>
MCP_OAUTH_TOKEN_EXPIRES_IN=1h
MCP_OAUTH_REFRESH_EXPIRES_IN=30d

# Internal API bridge (MCP -> existing backend)
TRUSTED_NETWORK_API_URL=http://localhost:4000

# MCP Rate Limits (requests per minute)
MCP_RATE_LIMIT_READ=60
MCP_RATE_LIMIT_WRITE=20
MCP_RATE_LIMIT_SEARCH=30
```

---

## K. Security Baseline Assessment

| Security Control | Status |
|---|---|
| No direct MongoDB from ChatGPT | Ready — MCP calls HTTP API only |
| No DB credentials in MCP layer | Ready — MCP has no DB access |
| OAuth 2.1 with PKCE S256 | To implement |
| User identity from auth context only | Ready — design enforces this |
| Model cannot supply userId | Ready — userId never accepted from tool args |
| Ownership checks preserved | Ready — existing controllers enforce this |
| Admin APIs inaccessible from MCP | Ready — MCP will never call /api/admin |
| Input validation | To implement — Zod schemas per tool |
| Safe error responses | To implement — error mapper |
| Audit logging | To implement |
| MCP-specific rate limiting | To implement |
| HTTPS in production | Ready — Nginx + Certbot already in use |
| Image upload validation | Deferred — image upload via MCP not feasible |
| Idempotency for write operations | Not in backend — needs design decision |

---

*This document represents the complete Phase 1 analysis.*
*No code has been written yet.*
*Review and approve before proceeding to Phase 2 implementation.*
