/**
 * MCP Router for StreamableHTTP Transport.
 * Exposes both `/mcp` (standard) and `/openai/mcp` (OpenAI plugin endpoint).
 *
 * Implements:
 *  - POST /mcp & /openai/mcp: JSON-RPC request handling (initialize, tools/list, tools/call)
 *  - GET  /mcp & /openai/mcp: Server-Sent Events (SSE) stream for session
 *  - DELETE /mcp & /openai/mcp: Session teardown
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthMiddleware } from "./middleware/authentication";
import { createMcpServer } from "./server";
import logger from "../utils/logger";

const CTX = "MCPRouter";

export function createMcpRouter(
  sharedTransports?: Map<string, StreamableHTTPServerTransport>
): Router {
  const router = Router();
  const transports = sharedTransports || new Map<string, StreamableHTTPServerTransport>();
  const mcpPaths = ["/mcp", "/openai/mcp"];

  router.post(mcpPaths, mcpAuthMiddleware, async (req: Request, res: Response) => {
    // Streamable HTTP transport specification requires both application/json and text/event-stream
    const accept = (req.headers["accept"] as string) || "";
    const hasJson = accept.includes("application/json");
    const hasSse = accept.includes("text/event-stream");
    if (!hasJson || !hasSse) {
      req.headers["accept"] = [
        hasJson ? null : "application/json",
        hasSse ? null : "text/event-stream",
        accept || null
      ].filter(Boolean).join(", ");
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const context = req.mcpContext!;

    // Capture memberId at session creation time.
    // This closure ensures the identity cannot change mid-session.
    const memberId = context.memberId;

    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      // Create a new session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomBytes(16).toString("hex"),
        enableJsonResponse: true,
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport!);
          logger.info(`MCP session created: ${sid} for member ${memberId} on ${req.path}`, CTX);
        }
      });

      // Create a per-session McpServer with the member's identity locked in
      const mcpServer = createMcpServer(() => memberId);

      // Connect server to transport (fire and forget — transport handles lifecycle)
      mcpServer.connect(transport).catch((err: Error) => {
        logger.error("MCP server connect error", err, CTX);
      });
    }

    await transport.handleRequest(req, res, req.body);
  });

  router.get(mcpPaths, mcpAuthMiddleware, async (req: Request, res: Response) => {
    const accept = (req.headers["accept"] as string) || "";
    if (!accept.includes("text/event-stream")) {
      req.headers["accept"] = accept ? `${accept}, text/event-stream` : "text/event-stream";
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Mcp-Session-Id header required for SSE stream" });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transport.handleRequest(req, res);
  });

  router.delete(mcpPaths, mcpAuthMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Mcp-Session-Id header required" });
      return;
    }
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handleRequest(req, res, req.body);
      transports.delete(sessionId);
      logger.info(`MCP session destroyed: ${sessionId} on ${req.path}`, CTX);
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  return router;
}
