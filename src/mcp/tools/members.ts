/**
 * MCP Member tools.
 *
 * Tools:
 *   - search_members    → GET /mobile-api/members/
 *   - get_nearby_members → GET /mobile-api/members/nearby
 *   - get_member        → GET /mobile-api/members/:id
 *
 * Scope required: members:read
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as api from "../services/api";
import { toMcpError, errorResponse } from "../utils/errors";
import { auditToolCall, startTimer } from "../utils/logging";

export function registerMemberTools(server: McpServer, getMemberId: () => string): void {

  // ── search_members ─────────────────────────────────────────────────────────
  server.tool(
    "search_members",
    "Search the Trusted Network member directory by name, business name, city, state, or business category. Returns paginated results with connection status.",
    {
      search: z.string().max(100).optional().describe("Search query (name, business name, or city)"),
      city: z.string().max(100).optional().describe("Filter by city"),
      state: z.string().max(100).optional().describe("Filter by state name"),
      category: z.string().max(50).optional().describe("Filter by business category ID (ObjectId string)"),
      region: z.string().max(50).optional().describe("Filter by business region ID (ObjectId string)"),
      page: z.number().int().min(0).max(100).optional().default(0).describe("Page number (0-indexed)"),
      limit: z.number().int().min(1).max(50).optional().default(10).describe("Results per page (max 50)")
    },
    {
      readOnlyHint: true
    },
    async ({ search, city, state, category, region, page, limit }) => {
      const memberId = getMemberId();
      const timer = startTimer();
      const paramKeys = [search && "search", city && "city", state && "state", category && "category", region && "region", page && "page", limit && "limit"].filter(Boolean) as string[];

      try {
        const result = await api.searchMembers(memberId, {
          search,
          city,
          state,
          category,
          region,
          page,
          limit
        });

        auditToolCall({ tool: "search_members", memberId, paramKeys, outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "search_members");
        auditToolCall({ tool: "search_members", memberId, paramKeys, outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // ── get_nearby_members ─────────────────────────────────────────────────────
  server.tool(
    "get_nearby_members",
    "Find Trusted Network members within 5 km or 10 km of a given location. Location visibility rules are enforced: members with FOLLOWERS or MUTUAL visibility will only appear if you follow them. If lat/lng are omitted, falls back to the member's saved location on their profile.",
    {
      lat: z.number().min(-90).max(90).optional().describe("Latitude (decimal degrees)"),
      lng: z.number().min(-180).max(180).optional().describe("Longitude (decimal degrees)"),
      radius: z.enum(["5", "10"]).optional().default("10").describe("Search radius in kilometres: 5 or 10"),
      page: z.number().int().min(0).max(100).optional().default(0).describe("Page number (0-indexed)"),
      limit: z.number().int().min(1).max(100).optional().default(50).describe("Results per page (max 100)")
    },
    {
      readOnlyHint: true
    },
    async ({ lat, lng, radius, page, limit }) => {
      const memberId = getMemberId();
      const timer = startTimer();
      const paramKeys = [lat !== undefined && "lat", lng !== undefined && "lng", "radius", "page", "limit"].filter(Boolean) as string[];

      try {
        const result = await api.getNearbyMembers(memberId, {
          lat,
          lng,
          radius: radius === "5" ? 5 : 10,
          page,
          limit
        });

        auditToolCall({ tool: "get_nearby_members", memberId, paramKeys, outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "get_nearby_members");
        auditToolCall({ tool: "get_nearby_members", memberId, paramKeys, outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // ── get_member ─────────────────────────────────────────────────────────────
  server.tool(
    "get_member",
    "Get the public profile of any active Trusted Network member by their member ID. Includes their business details, recent posts, follower/following counts, contribution summary, and your connection status with them.",
    {
      memberId: z.string().min(24).max(24).describe("The 24-character MongoDB ObjectId of the member to look up")
    },
    {
      readOnlyHint: true
    },
    async ({ memberId: targetMemberId }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      try {
        const member = await api.getMember(memberId, targetMemberId);

        // Remove sensitive fields
        if (member) {
          delete member.pin;
          delete member.fcmToken;
          delete member.mobileNumber;
          delete member.email;
        }

        auditToolCall({ tool: "get_member", memberId, paramKeys: ["memberId"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: member }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "get_member");
        auditToolCall({ tool: "get_member", memberId, paramKeys: ["memberId"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );
}
