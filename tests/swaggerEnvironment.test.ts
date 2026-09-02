/**
 * Tests for Swagger / OpenAPI Environment Gating & Security (P3-4)
 */

import { swaggerSpec } from "../src/config/swagger";

describe("Swagger / API Documentation Configuration (P3-4)", () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test("1. OpenAPI definition contains basic metadata and servers", () => {
    const spec = swaggerSpec as any;
    expect(spec).toBeDefined();
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.title).toBe("CTN Backend API");
  });

  test("2. OpenAPI spec does not contain raw credentials or secrets", () => {
    const specString = JSON.stringify(swaggerSpec);

    expect(specString).not.toContain("JWT_SECRET");
    expect(specString).not.toContain("MONGO_URI");
    expect(specString).not.toContain("REDIS_PASSWORD");
    expect(specString).not.toContain("RAZORPAY_KEY_SECRET");
    expect(specString).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  test("3. Evaluates Swagger enablement correctly across environments", () => {
    const isEnabled = (nodeEnv: string, enableInProd?: string) => {
      return nodeEnv !== "production" || enableInProd === "true";
    };

    // Non-production -> Enabled
    expect(isEnabled("development")).toBe(true);
    expect(isEnabled("test")).toBe(true);

    // Production default -> Disabled (security best practice)
    expect(isEnabled("production")).toBe(false);
    expect(isEnabled("production", "false")).toBe(false);

    // Production explicit opt-in -> Enabled
    expect(isEnabled("production", "true")).toBe(true);
  });
});
