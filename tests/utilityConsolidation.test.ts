/**
 * Tests for Utility Consolidation (P2-1)
 */

import {
  calculateYearsBetween,
  parseAndValidateDob,
  IST_OFFSET_MS,
  getIstDate,
  hasPermission,
  response
} from "../src/utils";

describe("Utility Consolidation & Canonical Helpers (P2-1)", () => {
  test("1. calculateYearsBetween accurately computes calendar anniversary years", () => {
    const start = new Date("2020-05-15");
    const endBeforeAnniversary = new Date("2024-05-10");
    const endAfterAnniversary = new Date("2024-05-20");

    expect(calculateYearsBetween(start, endBeforeAnniversary)).toBe(3);
    expect(calculateYearsBetween(start, endAfterAnniversary)).toBe(4);
    // Minimum 1 year
    expect(calculateYearsBetween(start, new Date("2020-06-01"))).toBe(1);
  });

  test("2. parseAndValidateDob correctly parses various date formats and validates bounds", () => {
    const validYmd = parseAndValidateDob("1995-08-20");
    expect(validYmd.date).toBeInstanceOf(Date);
    expect(validYmd.error).toBeUndefined();

    const validDmy = parseAndValidateDob("20-08-1995");
    expect(validDmy.date).toBeInstanceOf(Date);
    expect(validDmy.error).toBeUndefined();

    const futureDate = parseAndValidateDob("2099-01-01");
    expect(futureDate.date).toBeNull();
    expect(futureDate.error).toContain("future");

    const ancientDate = parseAndValidateDob("1850-01-01");
    expect(ancientDate.date).toBeNull();
    expect(ancientDate.error).toContain("1900 or later");
  });

  test("3. IST timezone helpers return valid UTC+5:30 offset", () => {
    expect(IST_OFFSET_MS).toBe(19800000); // 5.5 hours in ms
    const baseUtc = new Date("2026-01-01T00:00:00.000Z");
    const ist = getIstDate(baseUtc);
    expect(ist.getTime() - baseUtc.getTime()).toBe(IST_OFFSET_MS);
  });

  test("4. hasPermission returns false when role has no matching permissions", async () => {
    const role: any = { permissions: [] };
    const allowed = await hasPermission(role, "unknown_module", "view");
    expect(allowed).toBe(false);
  });

  test("5. response utility formats standard response payload", () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    response(mockRes, 200, "Success message", { id: "123" });

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      statusCode: 200,
      message: "Success message",
      data: { id: "123" }
    });
  });
});
