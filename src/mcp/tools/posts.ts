/**
 * MCP Post tools.
 *
 * Tools:
 *   - get_my_posts    → GET /mobile-api/posts/my-posts
 *   - get_post        → GET /mobile-api/posts/:id
 *   - create_post     → POST /mobile-api/posts/
 *   - edit_post       → PUT /mobile-api/posts/:id
 *   - delete_post     → DELETE /mobile-api/posts/:id
 *
 * Post types: PROMOTION, GIVE, ASK, REQUIREMENT
 *
 * Notes on promotions:
 *   - There is NO separate Promotion entity in Trusted Network.
 *   - Promotions = Posts with type="PROMOTION".
 *   - Posts go live immediately on creation — there is no draft/publish lifecycle.
 *   - To create a promotion: use create_post with type="PROMOTION".
 *   - To list your promotions: use get_my_posts with type="PROMOTION".
 *
 * Scopes: posts:read for reads, posts:write for create/edit/delete.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as api from "../services/api";
import { toMcpError, errorResponse, McpValidationError } from "../utils/errors";
import { auditToolCall, startTimer } from "../utils/logging";

const POST_TYPES = ["PROMOTION", "GIVE", "ASK", "REQUIREMENT"] as const;
const REQUIREMENT_VISIBILITY = ["MUTUAL-FRIEND", "REGION", "OVERALL"] as const;

export function registerPostTools(server: McpServer, getMemberId: () => string): void {

  // ── get_my_posts ───────────────────────────────────────────────────────────
  server.tool(
    "get_my_posts",
    "Get your own posts on Trusted Network. Filter by post type (PROMOTION, GIVE, ASK, REQUIREMENT) and paginate results. To view only your promotions, set type to PROMOTION.",
    {
      type: z.enum(POST_TYPES).optional().describe("Filter by post type. PROMOTION = business promotions, GIVE = free offers, ASK = requests for help, REQUIREMENT = business requirements"),
      page: z.number().int().min(0).max(200).optional().default(0).describe("Page number (0-indexed)"),
      limit: z.number().int().min(1).max(50).optional().default(10).describe("Posts per page (max 50)")
    },
    async ({ type, page, limit }) => {
      const memberId = getMemberId();
      const timer = startTimer();
      const paramKeys = [type && "type", "page", "limit"].filter(Boolean) as string[];

      try {
        const result = await api.getMyPosts(memberId, { type, page, limit });

        auditToolCall({ tool: "get_my_posts", memberId, paramKeys, outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "get_my_posts");
        auditToolCall({ tool: "get_my_posts", memberId, paramKeys, outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // ── get_post ───────────────────────────────────────────────────────────────
  server.tool(
    "get_post",
    "Get the full details of a specific post by its ID, including title, description, type, media, member info, and engagement counts.",
    {
      postId: z.string().min(24).max(24).describe("The 24-character MongoDB ObjectId of the post")
    },
    async ({ postId }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      try {
        const post = await api.getPost(memberId, postId);

        auditToolCall({ tool: "get_post", memberId, paramKeys: ["postId"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: post }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "get_post");
        auditToolCall({ tool: "get_post", memberId, paramKeys: ["postId"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // ── create_post ────────────────────────────────────────────────────────────
  server.tool(
    "create_post",
    `Create a new post on Trusted Network. Posts go live immediately — there is no draft mode.

Post types:
- PROMOTION: Advertise your product, service, or offer (equivalent to creating a promotion)
- GIVE: Offer something for free to the network
- ASK: Request help, collaboration, or a referral
- REQUIREMENT: Post a business requirement or lead request (set requirementVisibility)

Note: To create a promotion, use type=PROMOTION. Images cannot be attached via this tool — use the mobile app to add media.`,
    {
      type: z.enum(POST_TYPES).describe("Post type: PROMOTION (promotions), GIVE (free offers), ASK (requests), REQUIREMENT (business requirements)"),
      title: z.string().min(1).max(500).describe("Post title — keep it concise and clear"),
      description: z.string().min(1).max(5000).describe("Post description — the full content of the post"),
      location: z.string().max(200).optional().describe("Location associated with the post (city, area, or address)"),
      period: z.string().max(100).optional().describe("Validity period or deadline (e.g. 'Valid until December 2025')"),
      requirementVisibility: z.enum(REQUIREMENT_VISIBILITY).optional().describe("Required when type=REQUIREMENT. OVERALL=visible to all, REGION=visible to members in your region, MUTUAL-FRIEND=visible only to mutual connections")
    },
    async ({ type, title, description, location, period, requirementVisibility }) => {
      const memberId = getMemberId();
      const timer = startTimer();
      const paramKeys = ["type", "title", "description", location && "location", period && "period", requirementVisibility && "requirementVisibility"].filter(Boolean) as string[];

      // Validate requirementVisibility requirement
      if (type === "REQUIREMENT" && !requirementVisibility) {
        const err = new McpValidationError("requirementVisibility is required when type is REQUIREMENT. Choose OVERALL, REGION, or MUTUAL-FRIEND.");
        auditToolCall({ tool: "create_post", memberId, paramKeys, outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      try {
        const post = await api.createPost(memberId, {
          type,
          title,
          description,
          location,
          period,
          requirementVisibility
        });

        auditToolCall({ tool: "create_post", memberId, paramKeys, outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `${type === "PROMOTION" ? "Promotion" : "Post"} created successfully and is now live.`,
                data: post
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "create_post");
        auditToolCall({ tool: "create_post", memberId, paramKeys, outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // ── edit_post ──────────────────────────────────────────────────────────────
  server.tool(
    "edit_post",
    "Edit an existing post you own on Trusted Network. You can update the title, description, location, period, or requirementVisibility. You can only edit your own posts — the ownership check is enforced by the backend.",
    {
      postId: z.string().min(24).max(24).describe("The 24-character MongoDB ObjectId of the post to edit"),
      title: z.string().min(1).max(500).optional().describe("New post title"),
      description: z.string().min(1).max(5000).optional().describe("New post description"),
      location: z.string().max(200).optional().describe("New location"),
      period: z.string().max(100).optional().describe("New period or deadline"),
      requirementVisibility: z.enum(REQUIREMENT_VISIBILITY).optional().describe("New visibility for REQUIREMENT posts")
    },
    async ({ postId, title, description, location, period, requirementVisibility }) => {
      const memberId = getMemberId();
      const timer = startTimer();
      const paramKeys = ["postId", title && "title", description && "description", location && "location", period && "period", requirementVisibility && "requirementVisibility"].filter(Boolean) as string[];

      // At least one update field must be present
      if (!title && !description && !location && !period && !requirementVisibility) {
        const err = new McpValidationError("At least one field to update must be provided (title, description, location, period, or requirementVisibility).");
        auditToolCall({ tool: "edit_post", memberId, paramKeys, outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      try {
        const updated = await api.editPost(memberId, postId, {
          title,
          description,
          location,
          period,
          requirementVisibility
        });

        auditToolCall({ tool: "edit_post", memberId, paramKeys, outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Post updated successfully.",
                data: updated
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "edit_post");
        auditToolCall({ tool: "edit_post", memberId, paramKeys, outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // ── delete_post ────────────────────────────────────────────────────────────
  server.tool(
    "delete_post",
    "Delete one of your own posts from Trusted Network. This action is permanent — the post will be soft-deleted and removed from the feed. You can only delete your own posts; the backend enforces this ownership check.",
    {
      postId: z.string().min(24).max(24).describe("The 24-character MongoDB ObjectId of the post to delete"),
      confirm: z.literal(true).describe("Must be true to confirm deletion — prevents accidental deletes")
    },
    async ({ postId, confirm }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      if (!confirm) {
        const err = new McpValidationError("Deletion not confirmed. Set confirm=true to proceed with deletion.");
        auditToolCall({ tool: "delete_post", memberId, paramKeys: ["postId", "confirm"], outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      try {
        const result = await api.deletePost(memberId, postId);

        auditToolCall({ tool: "delete_post", memberId, paramKeys: ["postId", "confirm"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Post deleted successfully."
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "delete_post");
        auditToolCall({ tool: "delete_post", memberId, paramKeys: ["postId", "confirm"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );
}
