/**
 * MCP Server — Trusted Network Business Assistant for ChatGPT.
 *
 * This module creates and configures the McpServer instance with all tools.
 * It is separate from Express routing — the server uses StreamableHTTP transport.
 *
 * Architecture:
 *  - Each MCP request carries an OAuth 2.1 Bearer token
 *  - The token is validated by mcpAuthMiddleware before reaching this server
 *  - Tools receive memberId via closure — never from tool arguments
 *  - All tool calls proxy to the existing /mobile-api routes
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProfileTools } from "./tools/profile";
import { registerMemberTools } from "./tools/members";
import { registerPostTools } from "./tools/posts";
import { registerPromotionTools } from "./tools/promotions";

/**
 * Creates a new McpServer instance with all registered tools.
 *
 * @param getMemberId - Getter that returns the authenticated member's ID
 *   from the validated OAuth token context. The model cannot override this.
 */
export function createMcpServer(getMemberId: () => string): McpServer {
  const server = new McpServer({
    name: "trusted-network-mcp",
    version: "1.0.0"
  });

  // Register all tool groups
  registerProfileTools(server, getMemberId);
  registerMemberTools(server, getMemberId);
  registerPostTools(server, getMemberId);
  registerPromotionTools(server, getMemberId);

  return server;
}
