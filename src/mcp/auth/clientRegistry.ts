/**
 * Client Registry and Identification for CTN OAuth 2.1.
 *
 * Supports:
 *  1. Client ID Metadata Document (CIMD) — HTTPS URL client_id with SSRF protection
 *  2. Dynamic Client Registration (DCR) — POST /oauth/register
 *  3. Predefined ChatGPT / CTN clients with strict redirect URI allowlisting
 */

import dns from "dns";
import { URL } from "url";
import axios from "axios";
import crypto from "crypto";
import { appRedis } from "../../config/appRedis";
import logger from "../../utils/logger";

const CTX = "ClientRegistry";

const REDIS_DCR_PREFIX = "oauth:client:dcr:";
const REDIS_CIMD_PREFIX = "oauth:client:cimd:";
const CIMD_CACHE_TTL_SEC = 3600; // 1 hour

export interface RegisteredClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scopes?: string[];
  client_id_issued_at?: number;
}

/**
 * Known valid ChatGPT redirect URI patterns according to OpenAI connector specifications.
 */
export const CHATGPT_REDIRECT_PATTERNS: RegExp[] = [
  // Official ChatGPT platform redirect (RFC 9207 compliant)
  /^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect(?:\?.*)?$/,
  // Connector callback with callback ID
  /^https:\/\/chatgpt\.com\/connector\/oauth\/[a-zA-Z0-9_\-]+(?:\?.*)?$/,
  /^https:\/\/chat\.openai\.com\/connector\/oauth\/[a-zA-Z0-9_\-]+(?:\?.*)?$/,
  // Custom GPT AIP callback
  /^https:\/\/chatgpt\.com\/aip\/[a-zA-Z0-9_\-]+\/oauth\/callback(?:\?.*)?$/,
  // Local development redirect URIs (allowed in non-production only)
  ...(process.env.NODE_ENV !== "production"
    ? [/^http:\/\/localhost(?::\d+)?(?:\/.*)?$/, /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/.*)?$/]
    : [])
];

/**
 * Checks if an IP address belongs to private, loopback, or link-local ranges (SSRF protection).
 */
function isPrivateOrLocalIp(ip: string): boolean {
  // IPv4 checks
  if (
    ip === "0.0.0.0" ||
    ip === "127.0.0.1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.") // link-local / AWS metadata
  ) {
    return true;
  }

  // 172.16.0.0 – 172.31.255.255
  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172) {
    const second = parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  // IPv6 checks
  if (
    ip === "::1" ||
    ip === "::" ||
    ip.toLowerCase().startsWith("fe80:") ||
    ip.toLowerCase().startsWith("fc00:") ||
    ip.toLowerCase().startsWith("fd00:")
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that an HTTPS URL does not resolve to an internal network (SSRF protection).
 */
async function validateSsrfSafeUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);

  if (parsed.protocol !== "https:") {
    throw new Error("Client metadata document must be served over HTTPS");
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname === "localhost") {
    throw new Error("Invalid or local hostname in client_id");
  }

  // Resolve hostname to IP addresses
  const addresses = await dns.promises.lookup(hostname, { all: true });
  for (const addr of addresses) {
    if (isPrivateOrLocalIp(addr.address)) {
      throw new Error(`Client ID resolves to prohibited internal address: ${addr.address}`);
    }
  }

  return parsed;
}

/**
 * Verifies if a given redirect URI is valid for the given client configuration.
 */
export function isRedirectUriMatching(requestedUri: string, allowedUris: string[]): boolean {
  for (const allowed of allowedUris) {
    // Exact match
    if (requestedUri === allowed) return true;
  }
  return false;
}

/**
 * Checks if a redirect URI matches known ChatGPT redirect patterns or configured env var.
 */
export function matchesChatGPTCallbackPattern(uri: string): boolean {
  if (process.env.CHATGPT_OAUTH_REDIRECT_URI && uri === process.env.CHATGPT_OAUTH_REDIRECT_URI) {
    return true;
  }
  return CHATGPT_REDIRECT_PATTERNS.some((pattern) => pattern.test(uri));
}

export class ClientRegistry {
  /**
   * Fetches and validates a Client ID Metadata Document (CIMD) with SSRF protection.
   */
  async fetchClientMetadataDocument(clientIdUrl: string): Promise<RegisteredClient> {
    // Check Redis cache first
    try {
      const cached = await appRedis.get(`${REDIS_CIMD_PREFIX}${clientIdUrl}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Redis error non-fatal, proceed with fetch
    }

    // SSRF validation
    await validateSsrfSafeUrl(clientIdUrl);

    // Fetch document with short timeout and size limit
    const response = await axios.get(clientIdUrl, {
      timeout: 5000,
      headers: {
        Accept: "application/json, application/oauth-client-metadata+json",
        "User-Agent": "CTN-OAuth-Server/1.0"
      },
      maxContentLength: 64 * 1024 // 64 KB max
    });

    const doc = response.data;
    if (!doc || typeof doc !== "object") {
      throw new Error("Invalid client metadata document: expected JSON object");
    }

    if (doc.client_id !== clientIdUrl) {
      throw new Error("client_id in document does not match request URL");
    }

    if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) {
      throw new Error("client metadata document must contain redirect_uris array");
    }

    const client: RegisteredClient = {
      client_id: clientIdUrl,
      client_name: doc.client_name || "ChatGPT Client",
      redirect_uris: doc.redirect_uris,
      grant_types: doc.grant_types || ["authorization_code", "refresh_token"],
      response_types: doc.response_types || ["code"],
      token_endpoint_auth_method: doc.token_endpoint_auth_method || "none"
    };

    // Cache valid document in Redis
    try {
      await appRedis.setex(
        `${REDIS_CIMD_PREFIX}${clientIdUrl}`,
        CIMD_CACHE_TTL_SEC,
        JSON.stringify(client)
      );
    } catch {
      // Non-fatal
    }

    return client;
  }

  /**
   * Registers a client via Dynamic Client Registration (RFC 7591).
   */
  async registerClient(input: {
    client_name?: string;
    redirect_uris: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
    scope?: string;
  }): Promise<RegisteredClient> {
    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
      throw new Error("redirect_uris is required and must be a non-empty array");
    }

    // Validate that each redirect_uri is either an allowed ChatGPT URI, HTTPS, or localhost in dev
    for (const uri of input.redirect_uris) {
      if (!matchesChatGPTCallbackPattern(uri)) {
        try {
          const parsed = new URL(uri);
          if (parsed.protocol !== "https:" && (process.env.NODE_ENV === "production" || parsed.hostname !== "localhost")) {
            throw new Error(`Prohibited redirect URI: ${uri}`);
          }
        } catch {
          throw new Error(`Invalid redirect URI format: ${uri}`);
        }
      }
    }

    const clientId = "ctn_client_" + crypto.randomBytes(16).toString("hex");
    const issuedAt = Math.floor(Date.now() / 1000);

    const client: RegisteredClient = {
      client_id: clientId,
      client_name: input.client_name || "Dynamic OAuth Client",
      redirect_uris: input.redirect_uris,
      grant_types: input.grant_types || ["authorization_code", "refresh_token"],
      response_types: input.response_types || ["code"],
      token_endpoint_auth_method: input.token_endpoint_auth_method || "none",
      scopes: input.scope ? input.scope.split(" ") : undefined,
      client_id_issued_at: issuedAt
    };

    // Store in Redis (1 year TTL)
    await appRedis.setex(
      `${REDIS_DCR_PREFIX}${clientId}`,
      365 * 86400,
      JSON.stringify(client)
    );

    logger.info(`OAuth client registered via DCR: ${clientId} (${client.client_name})`, CTX);
    return client;
  }

  /**
   * Validates a client_id and redirect_uri against CIMD, DCR, or predefined client list.
   */
  async validateClient(clientId: string, redirectUri?: string): Promise<RegisteredClient> {
    if (!clientId) {
      throw new Error("client_id is required");
    }

    // 1. CIMD: Client ID is an HTTPS metadata document URL
    if (clientId.startsWith("https://")) {
      const client = await this.fetchClientMetadataDocument(clientId);
      if (redirectUri && !isRedirectUriMatching(redirectUri, client.redirect_uris)) {
        throw new Error(`redirect_uri ${redirectUri} is not registered in client metadata document`);
      }
      return client;
    }

    // 2. DCR: Check if registered in Redis
    try {
      const dcrRaw = await appRedis.get(`${REDIS_DCR_PREFIX}${clientId}`);
      if (dcrRaw) {
        const client = JSON.parse(dcrRaw) as RegisteredClient;
        if (redirectUri && !isRedirectUriMatching(redirectUri, client.redirect_uris)) {
          throw new Error(`redirect_uri ${redirectUri} is not registered for this client`);
        }
        return client;
      }
    } catch (err: any) {
      if (err.message.includes("redirect_uri")) throw err;
    }

    // 3. Predefined ChatGPT / CTN client identification
    if (clientId === "chatgpt-mcp" || clientId === "chatgpt" || clientId === "trusted-network-chatgpt") {
      // Validate redirect URI against ChatGPT allowed patterns
      if (redirectUri) {
        if (!matchesChatGPTCallbackPattern(redirectUri)) {
          throw new Error(`redirect_uri ${redirectUri} is not an authorized ChatGPT redirect URI`);
        }
      }

      return {
        client_id: clientId,
        client_name: "ChatGPT MCP Connector",
        redirect_uris: redirectUri ? [redirectUri] : ["https://chatgpt.com/connector_platform_oauth_redirect"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      };
    }

    throw new Error(`Unknown or invalid client_id: ${clientId}`);
  }
}

export const clientRegistry = new ClientRegistry();
