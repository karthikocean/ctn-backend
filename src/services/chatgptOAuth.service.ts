/**
 * Service for Managing ChatGPT MCP Integration, Connection Guidance, Status, and Disconnects.
 */

import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { OAuthGrant } from "../entity/OAuthGrant";
import { appRedis } from "../config/appRedis";
import { mcpConfig } from "../mcp/config";
import logger from "../utils/logger";

const CTX = "ChatGptOAuthService";

export interface ConnectionGuideResult {
  title: string;
  description: string;
  setupInstructions: string;
  mcpServerUrl: string;
  appListingUrl?: string;
  provider: string;
}

export interface ConnectionStatusResult {
  connected: boolean;
  provider: string;
  scopes: string[];
  clientId?: string;
  connectedAt?: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
}

export class ChatGptOAuthService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private grantRepo = AppDataSource.getMongoRepository(OAuthGrant);

  /**
   * Provides clean, user-friendly guidance for connecting Trusted Network to ChatGPT.
   * ChatGPT initiates OAuth discovery from the MCP server URL.
   */
  async getConnectionGuide(memberId: string): Promise<ConnectionGuideResult> {
    if (!ObjectId.isValid(memberId)) {
      throw new Error("Invalid member ID");
    }

    const member = await this.memberRepo.findOne({
      where: { _id: new ObjectId(memberId), isDeleted: false }
    });

    if (!member) {
      throw new Error("Member not found");
    }

    if (member.status === MemberStatus.BLOCKED) {
      throw new Error("Account is blocked. Please contact support.");
    }

    const mcpPublicUrl = mcpConfig.publicUrl.replace(/\/+$/, "");
    const appListingUrl =
      process.env.CHATGPT_PUBLIC_LISTING_URL ||
      process.env.CHATGPT_CONNECTION_URL ||
      process.env.CHATGPT_APP_LISTING_URL ||
      undefined;

    return {
      title: "Connect with ChatGPT",
      description: "Connect your Trusted Network account to ChatGPT to access your profile, search business members, and manage supported posts using ChatGPT.",
      setupInstructions: appListingUrl
        ? "Tap the link below to open Trusted Network in ChatGPT and authorize your account."
        : "Open ChatGPT and connect Trusted Network from the available Apps/Connectors using the server URL.",
      mcpServerUrl: `${mcpPublicUrl}/mcp`,
      appListingUrl,
      provider: "chatgpt"
    };
  }

  /**
   * Legacy method for backward compatibility in existing tests.
   * Note: Production clients should initiate OAuth from ChatGPT directly.
   */
  async generateConnectionUrl(memberId: string, options: { clientId?: string; redirectUri?: string; scopes?: string[] } = {}): Promise<string> {
    const guide = await this.getConnectionGuide(memberId);
    // If an official listing URL exists, return that; otherwise return MCP public URL instructions
    if (guide.appListingUrl) {
      return guide.appListingUrl;
    }

    // If a redirect URI was explicitly provided (e.g. In tests or official ChatGPT app connector)
    if (options.redirectUri) {
      const issuer = mcpConfig.oauth.issuer.replace(/\/+$/, "");
      const params = new URLSearchParams({
        response_type: "code",
        client_id: options.clientId || "chatgpt",
        redirect_uri: options.redirectUri,
        scope: (options.scopes && options.scopes.length > 0 ? options.scopes : ["profile:read", "members:read", "posts:read", "posts:create"]).join(" "),
        state: require("crypto").randomBytes(16).toString("hex"),
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        resource: mcpConfig.oauth.resource
      });
      return `${issuer}/oauth/authorize?${params.toString()}`;
    }

    return guide.mcpServerUrl;
  }

  /**
   * Retrieves connection status for a member.
   */
  async getConnectionStatus(memberId: string): Promise<ConnectionStatusResult> {
    if (!ObjectId.isValid(memberId)) {
      return { connected: false, provider: "chatgpt", scopes: [] };
    }

    const grant = await this.grantRepo.findOne({
      where: {
        userId: new ObjectId(memberId),
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      } as any,
      order: { createdAt: "DESC" } as any
    });

    if (!grant) {
      return { connected: false, provider: "chatgpt", scopes: [] };
    }

    return {
      connected: true,
      provider: "chatgpt",
      scopes: grant.scopes || [],
      clientId: grant.clientId,
      connectedAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt || grant.createdAt,
      expiresAt: grant.expiresAt
    };
  }

  /**
   * Revokes all active ChatGPT OAuth grants and sessions for a member.
   */
  async disconnect(memberId: string): Promise<boolean> {
    if (!ObjectId.isValid(memberId)) {
      throw new Error("Invalid member ID");
    }

    const grants = await this.grantRepo.find({
      where: {
        userId: new ObjectId(memberId),
        isRevoked: false
      } as any
    });

    const now = new Date();
    for (const grant of grants) {
      grant.isRevoked = true;
      grant.revokedAt = now;
      await this.grantRepo.save(grant);
    }

    // Invalidate Redis sessions
    try {
      const keys = await appRedis.keys("mcp:access:*");
      for (const key of keys) {
        const val = await appRedis.get(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.memberId === memberId) {
              await appRedis.del(key);
            }
          } catch {
            // ignore
          }
        }
      }

      const refreshKeys = await appRedis.keys("mcp:refresh:*");
      for (const key of refreshKeys) {
        const val = await appRedis.get(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.memberId === memberId) {
              await appRedis.del(key);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (redisErr: any) {
      logger.warn(`Redis session cleanup warning during disconnect: ${redisErr.message}`, CTX);
    }

    logger.info(JSON.stringify({
      event: "CHATGPT_OAUTH_DISCONNECTED",
      userId: memberId,
      grantsRevoked: grants.length,
      timestamp: now.toISOString()
    }), CTX);

    return true;
  }
}

export const chatgptOAuthService = new ChatGptOAuthService();
