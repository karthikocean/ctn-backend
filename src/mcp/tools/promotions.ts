/**
 * MCP Promotion tools with two-phase draft and explicit confirmation workflow.
 *
 * Tools:
 *   - get_my_promotions  → List user's active promotion posts (posts:read)
 *   - create_promotion   → Creates a promotion draft for review (posts:create)
 *   - publish_promotion  → Explicitly publishes a reviewed draft (posts:create)
 *   - edit_promotion     → Edits an existing promotion (posts:create)
 *   - delete_promotion   → Deletes a promotion with confirmation (posts:create)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import crypto from "crypto";
import * as api from "../services/api";
import { toMcpError, errorResponse, McpValidationError } from "../utils/errors";
import { auditToolCall, startTimer } from "../utils/logging";
import { appRedis } from "../../config/appRedis";

const PROMO_DRAFT_PREFIX = "mcp:promo_draft:";
const PROMO_DRAFT_TTL_SEC = 86400; // 24 hours

export function registerPromotionTools(server: McpServer, getMemberId: () => string): void {

  // 1. get_my_promotions
  server.tool(
    "get_my_promotions",
    "Get all active business promotions you have posted on Trusted Network.",
    {
      page: z.number().int().min(0).max(200).optional().default(0).describe("Page number (0-indexed)"),
      limit: z.number().int().min(1).max(50).optional().default(10).describe("Promotions per page (max 50)")
    },
    {
      readOnlyHint: true
    },
    async ({ page, limit }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      try {
        const result = await api.getMyPosts(memberId, { type: "PROMOTION", page, limit });
        auditToolCall({ tool: "get_my_promotions", memberId, paramKeys: ["page", "limit"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "get_my_promotions");
        auditToolCall({ tool: "get_my_promotions", memberId, paramKeys: ["page", "limit"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // 2. create_promotion (Creates Draft)
  server.tool(
    "create_promotion",
    "Create a draft business promotion or special offer. This creates a DRAFT and does NOT publish immediately. You must show the draft details to the user and request explicit confirmation before calling publish_promotion.",
    {
      title: z.string().min(1).max(500).describe("Promotion title or deal headline"),
      description: z.string().min(1).max(5000).describe("Full offer details, terms, and call to action"),
      location: z.string().max(200).optional().describe("Location or service area applicable to this promotion"),
      period: z.string().max(100).optional().describe("Validity period (e.g. 'Valid until 31st October')")
    },
    {
      readOnlyHint: false,
      destructiveHint: false
    },
    async ({ title, description, location, period }) => {
      const memberId = getMemberId();
      const timer = startTimer();
      const draftId = "draft_" + crypto.randomBytes(12).toString("hex");

      const draftData = {
        draftId,
        memberId,
        type: "PROMOTION",
        title,
        description,
        location,
        period,
        createdAt: Date.now()
      };

      try {
        await appRedis.setex(
          `${PROMO_DRAFT_PREFIX}${draftId}`,
          PROMO_DRAFT_TTL_SEC,
          JSON.stringify(draftData)
        );

        auditToolCall({ tool: "create_promotion", memberId, paramKeys: ["title", "description"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Promotion draft created successfully. Review the details below and confirm to publish.",
                draftId,
                draft: {
                  title,
                  description,
                  location,
                  period
                },
                nextStep: "Ask the user: 'Would you like to publish this promotion now?' If confirmed, call publish_promotion with this draftId and confirm=true."
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "create_promotion");
        auditToolCall({ tool: "create_promotion", memberId, paramKeys: ["title", "description"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // 3. publish_promotion (Explicit Confirmation)
  server.tool(
    "publish_promotion",
    "Publish a previously drafted promotion to make it live across the Trusted Network. Requires explicit user confirmation (confirm=true).",
    {
      draftId: z.string().min(10).describe("The draft ID returned by create_promotion"),
      confirm: z.literal(true).describe("Must be true to confirm publishing")
    },
    {
      readOnlyHint: false,
      destructiveHint: false
    },
    async ({ draftId, confirm }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      if (!confirm) {
        const err = new McpValidationError("Publishing not confirmed. Set confirm=true to publish.");
        auditToolCall({ tool: "publish_promotion", memberId, paramKeys: ["draftId", "confirm"], outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      const raw = await appRedis.get(`${PROMO_DRAFT_PREFIX}${draftId}`);
      if (!raw) {
        const err = new McpValidationError("Promotion draft not found or expired. Please create a new draft.");
        auditToolCall({ tool: "publish_promotion", memberId, paramKeys: ["draftId"], outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      const draft = JSON.parse(raw);
      if (draft.memberId !== memberId) {
        const err = new McpValidationError("You do not have permission to publish this draft.");
        auditToolCall({ tool: "publish_promotion", memberId, paramKeys: ["draftId"], outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      try {
        const published = await api.createPost(memberId, {
          type: "PROMOTION",
          title: draft.title,
          description: draft.description,
          location: draft.location,
          period: draft.period
        });

        // Delete draft upon publishing
        await appRedis.del(`${PROMO_DRAFT_PREFIX}${draftId}`);

        auditToolCall({ tool: "publish_promotion", memberId, paramKeys: ["draftId", "confirm"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Promotion published successfully and is now live on Trusted Network.",
                data: published
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "publish_promotion");
        auditToolCall({ tool: "publish_promotion", memberId, paramKeys: ["draftId"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // 4. edit_promotion
  server.tool(
    "edit_promotion",
    "Edit an existing promotion that you posted on Trusted Network. Ownership check is enforced by the backend.",
    {
      promotionId: z.string().min(24).max(24).describe("The 24-character ObjectId of the promotion post"),
      title: z.string().min(1).max(500).optional().describe("Updated promotion title"),
      description: z.string().min(1).max(5000).optional().describe("Updated description"),
      location: z.string().max(200).optional().describe("Updated location"),
      period: z.string().max(100).optional().describe("Updated validity period")
    },
    {
      readOnlyHint: false,
      destructiveHint: false
    },
    async ({ promotionId, title, description, location, period }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      if (!title && !description && !location && !period) {
        const err = new McpValidationError("At least one field to update must be provided.");
        auditToolCall({ tool: "edit_promotion", memberId, paramKeys: ["promotionId"], outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      try {
        const updated = await api.editPost(memberId, promotionId, {
          title,
          description,
          location,
          period
        });

        auditToolCall({ tool: "edit_promotion", memberId, paramKeys: ["promotionId"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Promotion updated successfully.",
                data: updated
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "edit_promotion");
        auditToolCall({ tool: "edit_promotion", memberId, paramKeys: ["promotionId"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );

  // 5. delete_promotion
  server.tool(
    "delete_promotion",
    "Delete one of your promotions from Trusted Network. This action is permanent and soft-deletes the promotion. Requires explicit confirmation (confirm=true).",
    {
      promotionId: z.string().min(24).max(24).describe("The 24-character ObjectId of the promotion post to delete"),
      confirm: z.literal(true).describe("Must be true to confirm deletion")
    },
    {
      readOnlyHint: false,
      destructiveHint: true
    },
    async ({ promotionId, confirm }) => {
      const memberId = getMemberId();
      const timer = startTimer();

      if (!confirm) {
        const err = new McpValidationError("Deletion not confirmed. Set confirm=true to proceed.");
        auditToolCall({ tool: "delete_promotion", memberId, paramKeys: ["promotionId"], outcome: "error", errorCode: err.code, durationMs: timer() });
        return errorResponse(err);
      }

      try {
        await api.deletePost(memberId, promotionId);
        auditToolCall({ tool: "delete_promotion", memberId, paramKeys: ["promotionId", "confirm"], outcome: "success", durationMs: timer() });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Promotion deleted successfully."
              }, null, 2)
            }
          ]
        };
      } catch (err: any) {
        const mcpErr = err.code ? err : toMcpError(err, "delete_promotion");
        auditToolCall({ tool: "delete_promotion", memberId, paramKeys: ["promotionId", "confirm"], outcome: "error", errorCode: mcpErr.code, durationMs: timer() });
        return errorResponse(mcpErr);
      }
    }
  );
}
