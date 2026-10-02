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
     * Must match the `iss` claim in issued tokens.
     */
    issuer: process.env.MCP_OAUTH_ISSUER || process.env.MCP_PUBLIC_URL || "http://localhost:4001",

    /**
     * Audience for issued tokens.
     * ChatGPT must present tokens with this audience claim.
     */
    audience: process.env.MCP_OAUTH_AUDIENCE || "trusted-network-mcp",

    /**
     * Signing secret for MCP OAuth tokens.
     * MUST be different from JWT_SECRET (the mobile app secret).
     * Generate with: openssl rand -hex 64
     */
    tokenSecret: process.env.MCP_OAUTH_TOKEN_SECRET || "",

    /** Access token lifetime (e.g. "1h", "30m") */
    tokenExpiresIn: process.env.MCP_OAUTH_TOKEN_EXPIRES_IN || "1h",

    /** Refresh token lifetime (e.g. "30d") */
    refreshExpiresIn: process.env.MCP_OAUTH_REFRESH_EXPIRES_IN || "30d"
  },

  /**
   * Base URL of the existing Trusted Network backend.
   * MCP calls this to proxy tool requests.
   */
  apiUrl: process.env.TRUSTED_NETWORK_API_URL || "http://localhost:4000",

  rateLimits: {
    /** Read tool requests per minute per user */
    read: parseInt(process.env.MCP_RATE_LIMIT_READ || "60", 10),
    /** Write tool requests per minute per user */
    write: parseInt(process.env.MCP_RATE_LIMIT_WRITE || "20", 10),
    /** Search tool requests per minute per user */
    search: parseInt(process.env.MCP_RATE_LIMIT_SEARCH || "30", 10)
  }
};
