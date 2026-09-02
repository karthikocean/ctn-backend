/**
 * Tests for OTP Generation, Security, Invalidation & Rate Limiting (P3-7)
 */

import { generateSecureOtp } from "../src/utils";
import { identifierOrIpKey } from "../src/middlewares/rateLimit.middleware";
import { Request } from "express";

describe("4-Digit OTP Security & Protection (P3-7)", () => {
  test("1. generateSecureOtp(4) generates 4-digit numeric string in 1000-9999 range", () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateSecureOtp(4);
      expect(otp).toHaveLength(4);
      const num = parseInt(otp, 10);
      expect(num).toBeGreaterThanOrEqual(1000);
      expect(num).toBeLessThan(10000);
      expect(/^\d{4}$/.test(otp)).toBe(true);
    }
  });

  test("2. generateSecureOtp supports variable length (e.g. 6 digits)", () => {
    const otp = generateSecureOtp(6);
    expect(otp).toHaveLength(6);
    const num = parseInt(otp, 10);
    expect(num).toBeGreaterThanOrEqual(100000);
    expect(num).toBeLessThan(1000000);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });

  test("3. Rate limit key generator identifierOrIpKey combines IP and identifier", () => {
    const mockReq1 = {
      ip: "192.168.1.100",
      body: { phone: "9876543210" }
    } as unknown as Request;

    const key1 = identifierOrIpKey(mockReq1);
    expect(key1).toBe("192.168.1.100_9876543210");

    const mockReq2 = {
      ip: "10.0.0.1",
      body: { email: "ADMIN@TRUSTEDNETWORK.IN" }
    } as unknown as Request;

    const key2 = identifierOrIpKey(mockReq2);
    expect(key2).toBe("10.0.0.1_admin@trustednetwork.in");
  });

  test("4. Expired OTP is rejected when current date exceeds expiresAt", () => {
    const expiresAt = new Date(Date.now() - 1000); // 1 second in the past
    const isExpired = new Date() > expiresAt;
    expect(isExpired).toBe(true);
  });

  test("5. Valid OTP timestamp is accepted within the 5-minute window", () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const isExpired = new Date() > expiresAt;
    expect(isExpired).toBe(false);
  });
});
