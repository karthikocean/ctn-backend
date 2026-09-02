/**
 * Tests for Structured Production Logging & Redaction (P3-1)
 */

import { logger, sanitizeLogData } from "../src/utils/logger";

describe("Structured Production Logging (P3-1)", () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test("1. sanitizeLogData redacts sensitive fields recursively", () => {
    const rawPayload = {
      email: "test@example.com",
      password: "SuperSecretPassword123",
      pin: "1234",
      otp: "987654",
      token: "eyJhbGciOiJIUzI1Ni...",
      authorization: "Bearer eyJhbGci...",
      razorpay_signature: "abc123sig",
      apiKey: "secret_api_key",
      nested: {
        pin: "5678",
        normalField: "visibleValue"
      }
    };

    const sanitized = sanitizeLogData(rawPayload);

    expect(sanitized.email).toBe("test@example.com");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.pin).toBe("[REDACTED]");
    expect(sanitized.otp).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.razorpay_signature).toBe("[REDACTED]");
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect(sanitized.nested.pin).toBe("[REDACTED]");
    expect(sanitized.nested.normalField).toBe("visibleValue");
  });

  test("2. Safely handles circular references without throwing", () => {
    const circularObj: any = { name: "Root" };
    circularObj.self = circularObj;

    const sanitized = sanitizeLogData(circularObj);
    expect(sanitized.name).toBe("Root");
    expect(sanitized.self).toBe("[Circular]");
  });

  test("3. Outputs valid JSON structured log in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.LOG_LEVEL;

    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.info("User logged in successfully", "AuthService", {
      userId: "12345",
      password: "secret_password"
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const loggedOutput = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(loggedOutput);

    expect(parsed.level).toBe("info");
    expect(parsed.context).toBe("AuthService");
    expect(parsed.message).toBe("User logged in successfully");
    expect(parsed.meta.userId).toBe("12345");
    expect(parsed.meta.password).toBe("[REDACTED]");
    expect(parsed.timestamp).toBeDefined();

    consoleLogSpy.mockRestore();
  });

  test("4. logger.child returns scoped sub-logger with context", () => {
    process.env.NODE_ENV = "production";
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const child = logger.child("PaymentGateway");
    child.info("Payment order initiated", { orderId: "ord_123" });

    expect(consoleLogSpy).toHaveBeenCalled();
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(parsed.context).toBe("PaymentGateway");
    expect(parsed.meta.orderId).toBe("ord_123");

    consoleLogSpy.mockRestore();
  });

  test("5. Respects LOG_LEVEL filter (e.g., debug suppressed when level is info)", () => {
    process.env.LOG_LEVEL = "info";
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.debug("Verbose debug information");
    expect(consoleLogSpy).not.toHaveBeenCalled();

    logger.info("Informational message");
    expect(consoleLogSpy).toHaveBeenCalled();

    consoleLogSpy.mockRestore();
  });
});
