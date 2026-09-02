/**
 * Tests for Database Cleanup Safety Guards (P2-5)
 */

import { validateCleanupExecution } from "../src/scripts/cleanup";

describe("Database Cleanup Safety Guards (P2-5)", () => {
  test("1. Blocks cleanup in production even with CONFIRM_DELETE_DATABASE=true", () => {
    const result = validateCleanupExecution("production", "true");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("strictly forbidden in production");
  });

  test("2. Blocks cleanup in production without confirmation", () => {
    const result = validateCleanupExecution("production", "false");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("strictly forbidden in production");
  });

  test("3. Blocks cleanup in development without CONFIRM_DELETE_DATABASE=true", () => {
    const result = validateCleanupExecution("development", "false");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("requires explicit confirmation");
  });

  test("4. Blocks cleanup in development with empty/missing confirmation", () => {
    const result = validateCleanupExecution("development", "");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("requires explicit confirmation");
  });

  test("5. Allows cleanup only in non-production with explicit CONFIRM_DELETE_DATABASE=true", () => {
    const result = validateCleanupExecution("development", "true");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
