/**
 * MCP Profile tools.
 *
 * Tool: get_my_profile
 *   Proxies: GET /mobile-api/members/profile
 *   Scope: profile:read
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as api from "../services/api";
import { toMcpError, errorResponse } from "../utils/errors";
import { auditToolCall, startTimer } from "../utils/logging";

export function registerProfileTools(server: McpServer, getMemberId: () => string): void {

  server.tool(
    "get_my_profile",
    "Get your own Trusted Network profile including business details, subscription status, connection counts, and contribution summary.",
    {},
    async () => {
      const memberId = getMemberId();
      const timer = startTimer();

      try {
        const profile = await api.getMyProfile(memberId);

        // Strip sensitive fields before returning to ChatGPT
        const safe = {
          _id: profile._id,
          fullName: profile.fullName,
          businessName: profile.businessName,
          businessType: profile.businessType,
          legalName: profile.legalName,
          about: profile.about,
          city: profile.city,
          state: profile.state,
          businessRegion: profile.businessRegion,
          businessAddress: profile.businessAddress,
          industry: profile.industry,
          yearsOfExperience: profile.yearsOfExperience,
          companySize: profile.companySize,
          gstNumber: profile.gstNumber,
          membershipType: profile.membershipType,
          websiteUrl: profile.websiteUrl,
          linkedinProfile: profile.linkedinProfile,
          instagram: profile.instagram,
          facebook: profile.facebook,
          youtubeLink: profile.youtubeLink,
          businessCategory: profile.businessCategory,
          subCategory: profile.subCategory,
          productsServices: profile.productsServices,
          productsServicesDescription: profile.productsServicesDescription,
          targetAudience: profile.targetAudience,
          serviceLocations: profile.serviceLocations,
          followersCount: profile.followersCount,
          followingsCount: profile.followingsCount,
          postsCount: profile.postsCount,
          points: profile.points,
          status: profile.status,
          createdAt: profile.createdAt,
          subscription: profile.subscription
          // Excluded: pin, fcmToken, password, profilePhoto (S3 path), workImages, certifications, businessDocuments
        };

        auditToolCall({ tool: "get_my_profile", memberId, paramKeys: [], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: safe }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "get_my_profile");
        auditToolCall({ tool: "get_my_profile", memberId, paramKeys: [], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );
}
