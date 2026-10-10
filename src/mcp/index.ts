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
import { createMcpRouter } from "./router";
import logger from "../utils/logger";
import { AppDataSource } from "../data-source";
import { appRedis } from "../config/appRedis";

import { getKeyPair } from "./auth/keys";

const CTX = "MCPIndex";

async function bootstrap() {
  if (!mcpConfig.enabled) {
    logger.info("MCP server is disabled (MCP_ENABLED != true). Exiting.", CTX);
    process.exit(0);
  }

  // Initialize RSA keypair for OAuth RS256 signing
  getKeyPair();

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

  // ── MCP StreamableHTTP endpoints (/mcp and /openai/mcp) ───────────────────
  // All MCP tool calls require a valid OAuth 2.1 Bearer token.
  // The memberId is extracted from the token and passed into each McpServer instance.
  // A new McpServer is created per-session to ensure complete isolation between users.
  const transports = new Map<string, StreamableHTTPServerTransport>();
  app.use("/", createMcpRouter(transports));

  // ── Start listening ────────────────────────────────────────────────────────
  const port = mcpConfig.port;
  app.listen(port, () => {
    logger.info(`Trusted Network MCP server running on port ${port}`, CTX);
    logger.info(`MCP Endpoint: ${mcpConfig.publicUrl}/mcp`, CTX);
    logger.info(`OpenAI MCP Endpoint: ${mcpConfig.publicUrl}/openai/mcp`, CTX);
    logger.info(`Protected Resource Metadata: ${mcpConfig.publicUrl}/.well-known/oauth-protected-resource`, CTX);
    logger.info(`OpenAI Protected Resource Metadata: ${mcpConfig.publicUrl}/openai/.well-known/oauth-protected-resource`, CTX);
    logger.info(`OAuth Metadata: ${mcpConfig.oauth.issuer}/.well-known/oauth-authorization-server`, CTX);
    logger.info(`JWKS: ${mcpConfig.oauth.issuer}/.well-known/jwks.json`, CTX);
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
