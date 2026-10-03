/**
 * MCP (Model Context Protocol) configuration.
 *
 * Reads from environment variables with safe defaults.
 * All secrets are kept as env vars — never hard-coded.
 */

export const mcpConfig = {
  /** Feature flag — set MCP_ENABLED=true to activate */
  enabled: process.env.MCP_ENABLED === "true",

  /** Port the MCP HTTP server listens on (separate from main API) */
  port: parseInt(process.env.MCP_PORT || "4001", 10),

  /**
   * Publicly accessible base URL for this MCP server.
   * Used for OAuth well-known metadata and redirect URIs.
   */
  publicUrl: process.env.MCP_PUBLIC_URL || "http://localhost:4001",

  oauth: {
    /**
     * OAuth 2.1 issuer identifier.
     * CTN Backend is the Authorization Server (api.trustednetwork.in).
     * Must match the `iss` claim in issued tokens.
     */
    issuer: process.env.OAUTH_ISSUER || process.env.MCP_OAUTH_ISSUER || "https://api.trustednetwork.in",

    /**
     * Audience / Canonical Resource for issued tokens.
     * MCP is the Resource Server (mcp.trustednetwork.in).
     */
    audience: process.env.OAUTH_RESOURCE || process.env.MCP_OAUTH_AUDIENCE || "https://mcp.trustednetwork.in",

    /**
     * Canonical protected resource URL.
     */
    resource: process.env.OAUTH_RESOURCE || "https://mcp.trustednetwork.in",

    /**
     * Signing secret for MCP OAuth tokens.
     */
    tokenSecret: process.env.MCP_OAUTH_TOKEN_SECRET || "",

    /** Access token lifetime in seconds */
    accessTokenTtlSec: parseInt(process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SEC || "3600", 10),

    /** Refresh token lifetime in seconds (30 days) */
    refreshTokenTtlSec: parseInt(process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_SEC || "2592000", 10)
  },

  /**
   * Base URL of the existing Trusted Network backend.
   * MCP calls this to proxy tool requests.
   */
  apiUrl: process.env.TRUSTED_NETWORK_API_URL || "http://127.0.0.1:5001",

  rateLimits: {
    /** Read tool requests per minute per user */
    read: parseInt(process.env.MCP_RATE_LIMIT_READ || "60", 10),
    /** Write tool requests per minute per user */
    write: parseInt(process.env.MCP_RATE_LIMIT_WRITE || "20", 10),
    /** Search tool requests per minute per user */
    search: parseInt(process.env.MCP_RATE_LIMIT_SEARCH || "30", 10)
  }
};
