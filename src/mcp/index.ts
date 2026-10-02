/**
 * MCP HTTP server entry point.
 *
 * This is a separate Express server from the main Trusted Network backend.
 * It listens on MCP_PORT (default 4001).
 *
 * Endpoints:
 *   GET  /.well-known/oauth-authorization-server  OAuth metadata (public)
 *   GET  /oauth/authorize                         OAuth login UI
 *   POST /oauth/authorize                         OAuth credential submission
 *   POST /oauth/token                             Token exchange
 *   POST /oauth/revoke                            Token revocation
 *   POST /mcp                                     MCP tool calls (requires auth)
 *   GET  /mcp                                     MCP SSE stream (requires auth)
 *   DELETE /mcp                                   MCP session teardown (requires auth)
 *   GET  /health                                  Health check (public)
 *
 * The main src/index.ts is NOT modified — this runs as a completely separate process.
 */

import "reflect-metadata";
import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpConfig } from "./config";
import { createOAuthRouter } from "./auth/oauth";
import { mcpAuthMiddleware } from "./middleware/authentication";
import { createMcpServer } from "./server";
import logger from "../utils/logger";
import { AppDataSource } from "../data-source";
import { appRedis } from "../config/appRedis";

const CTX = "MCPIndex";

async function bootstrap() {
  if (!mcpConfig.enabled) {
    logger.info("MCP server is disabled (MCP_ENABLED != true). Exiting.", CTX);
    process.exit(0);
  }

  if (!mcpConfig.oauth.tokenSecret) {
    logger.error("MCP_OAUTH_TOKEN_SECRET is not set. The MCP server cannot start securely.", undefined, CTX);
    process.exit(1);
  }

  // Connect to MongoDB (needed for Redis auth cache validation)
  await AppDataSource.initialize();
  logger.info("Database connected (MCP process)", CTX);

  // Connect to Redis
  appRedis.on("connect", () => logger.info("Redis connected (MCP process)", CTX));
  appRedis.on("error", (err) => logger.error("Redis error (MCP process)", err, CTX));

  const app = express();

  // Parse JSON and form-urlencoded bodies (OAuth token requests send application/x-www-form-urlencoded)
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS — allow ChatGPT origins and local dev tools / MCP Inspector
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        origin === "https://chatgpt.com" ||
        origin === "https://chat.openai.com" ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Accept"],
    exposedHeaders: ["Mcp-Session-Id"]
  }));

  // ── OAuth 2.1 routes (no auth required) ───────────────────────────────────
  app.use("/", createOAuthRouter());

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "trusted-network-mcp",
      version: "1.0.0",
      timestamp: new Date().toISOString()
    });
  });

  // ── MCP StreamableHTTP endpoint ────────────────────────────────────────────
  // All MCP tool calls require a valid OAuth 2.1 Bearer token.
  // The memberId is extracted from the token and passed into each McpServer instance.
  // A new McpServer is created per-session to ensure complete isolation between users.

  // In-memory session registry: sessionId -> McpServer transport
  // In production this should be backed by Redis for multi-instance deployments.
  // For now PM2 runs this in fork mode (single process) so in-memory is sufficient.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", mcpAuthMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const context = req.mcpContext!;

    // Capture memberId at session creation time.
    // This closure ensures the identity cannot change mid-session.
    const memberId = context.memberId;

    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      // Create a new session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => require("crypto").randomBytes(16).toString("hex"),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport!);
          logger.info(`MCP session created: ${sid} for member ${memberId}`, CTX);
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

  app.get("/mcp", mcpAuthMiddleware, async (req: Request, res: Response) => {
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

  app.delete("/mcp", mcpAuthMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Mcp-Session-Id header required" });
      return;
    }
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handleRequest(req, res, req.body);
      transports.delete(sessionId);
      logger.info(`MCP session destroyed: ${sessionId}`, CTX);
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  // ── Start listening ────────────────────────────────────────────────────────
  const port = mcpConfig.port;
  app.listen(port, () => {
    logger.info(`Trusted Network MCP server running on port ${port}`, CTX);
    logger.info(`Public URL: ${mcpConfig.publicUrl}`, CTX);
    logger.info(`OAuth metadata: ${mcpConfig.publicUrl}/.well-known/oauth-authorization-server`, CTX);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("MCP server shutting down...", CTX);
    for (const [sid, transport] of transports) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
      transports.delete(sid);
    }
    await AppDataSource.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
