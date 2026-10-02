/**
 * MCP audit logging utility.
 *
 * Security rules:
 *  - Log every tool call (tool name, user ID, parameters shape — never values of secrets).
 *  - Log outcome (success / error code).
 *  - Never log: tokens, PINs, passwords, full request bodies that may contain PII.
 */

import logger from "../../utils/logger";

const CTX = "MCPAudit";

export interface AuditEvent {
  /** MCP tool name */
  tool: string;
  /** Member ID extracted from OAuth token (never from tool args) */
  memberId: string;
  /** Parameter keys that were supplied — not their values */
  paramKeys: string[];
  /** HTTP status from backend, or local error code */
  outcome: "success" | "error";
  /** Error code when outcome === "error" */
  errorCode?: string;
  /** Response time in milliseconds */
  durationMs: number;
}

export function auditToolCall(event: AuditEvent): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event
  });
  logger.info(line, CTX);
}

/**
 * Creates a timer that returns duration in ms when called.
 */
export function startTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
