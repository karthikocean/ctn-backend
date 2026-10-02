/**
 * Service for Managing ChatGPT OAuth Onboarding, Connection Status, and Disconnects.
 */

import crypto from "crypto";
import { ObjectId } from "mongodb";
import { AppDataSource } from "../data-source";
import { Member, MemberStatus } from "../entity/Member";
import { OAuthGrant } from "../entity/OAuthGrant";
import { appRedis } from "../config/appRedis";
import { mcpConfig } from "../mcp/config";
import logger from "../utils/logger";

const CTX = "ChatGptOAuthService";
const TICKET_PREFIX = "chatgpt:ticket:";
const TICKET_TTL_SEC = 300; // 5 minutes

export interface GenerateUrlOptions {
  clientId?: string;
  redirectUri?: string;
  scopes?: string[];
}

export interface ConnectionStatusResult {
  connected: boolean;
  scopes: string[];
  clientId?: string;
  connectedAt?: Date;
  expiresAt?: Date;
}

export class ChatGptOAuthService {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private grantRepo = AppDataSource.getMongoRepository(OAuthGrant);

  /**
   * Generates a secure, short-lived OAuth connection URL for the mobile application.
   * Creates a pre-authenticated ticket (5 min TTL) so the authenticated mobile member
   * can review scopes and authorize ChatGPT without credential friction.
   */
  async generateConnectionUrl(memberId: string, options: GenerateUrlOptions = {}): Promise<string> {
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

    const clientId = options.clientId || "chatgpt-mcp";
    const redirectUri = options.redirectUri || "https://chatgpt.com/aip/oauth/callback";
    const scopes = options.scopes && options.scopes.length > 0
      ? options.scopes
      : ["profile:read", "members:read", "posts:read", "posts:create"];

    // Cryptographically secure state and ticket
    const state = crypto.randomBytes(24).toString("hex");
    const ticket = crypto.randomBytes(32).toString("hex");

    // PKCE parameters (S256)
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    // Store ticket in Redis with 5-minute TTL
    const ticketData = {
      memberId,
      fullName: member.fullName,
      mobileNumber: member.mobileNumber,
      clientId,
      redirectUri,
      scopes,
      state,
      codeVerifier,
      createdAt: Date.now()
    };

    await appRedis.setex(
      `${TICKET_PREFIX}${ticket}`,
      TICKET_TTL_SEC,
      JSON.stringify(ticketData)
    );

    // Also store PKCE challenge tied to state for OAuth RFC 7636
    await appRedis.setex(
      `mcp:pkce:${state}`,
      TICKET_TTL_SEC,
      JSON.stringify({
        codeChallenge,
        redirectUri,
        scopes,
        memberId
      })
    );

    // Construct authorization URL pointing to the MCP authorization server
    const baseAuthUrl = `${mcpConfig.publicUrl.replace(/\/+$/, "")}/oauth/authorize`;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ticket
    });

    logger.info(JSON.stringify({
      event: "CHATGPT_OAUTH_CONNECT_INITIATED",
      userId: memberId,
      clientId,
      scopes,
      timestamp: new Date().toISOString()
    }), CTX);

    return `${baseAuthUrl}?${params.toString()}`;
  }

  /**
   * Retrieves connection status for a member.
   */
  async getConnectionStatus(memberId: string): Promise<ConnectionStatusResult> {
    if (!ObjectId.isValid(memberId)) {
      return { connected: false, scopes: [] };
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
      return { connected: false, scopes: [] };
    }

    return {
      connected: true,
      scopes: grant.scopes || [],
      clientId: grant.clientId,
      connectedAt: grant.createdAt,
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
          const parsed = JSON.parse(val);
          if (parsed.memberId === memberId) {
            await appRedis.del(key);
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
