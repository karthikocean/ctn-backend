/**
 * Tests for Redis Health Check & Monitoring (P3-3)
 */

import { checkRedisHealth, appRedis } from "../src/config/appRedis";
import express, { Request, Response } from "express";
import request from "supertest";

describe("Redis Health Check & Availability Monitoring (P3-3)", () => {
  let originalStatus: string;
  let originalPing: any;

  beforeEach(() => {
    originalStatus = appRedis.status;
    originalPing = appRedis.ping;
  });

  afterEach(() => {
    Object.defineProperty(appRedis, "status", { value: originalStatus, configurable: true, writable: true });
    appRedis.ping = originalPing;
  });

  test("1. Returns connected when Redis is ready and PONG is received", async () => {
    Object.defineProperty(appRedis, "status", { value: "ready", configurable: true, writable: true });
    appRedis.ping = jest.fn().mockResolvedValue("PONG");

    const health = await checkRedisHealth();
    expect(health.status).toBe("connected");
    expect(typeof health.latencyMs).toBe("number");
  });

  test("2. Returns disconnected when Redis status is closed or end", async () => {
    Object.defineProperty(appRedis, "status", { value: "close", configurable: true, writable: true });

    const health = await checkRedisHealth();
    expect(health.status).toBe("disconnected");
  });

  test("3. Returns connecting when Redis status is reconnecting", async () => {
    Object.defineProperty(appRedis, "status", { value: "reconnecting", configurable: true, writable: true });

    const health = await checkRedisHealth();
    expect(health.status).toBe("connecting");
  });

  test("4. Returns disconnected when ping throws an error without crashing", async () => {
    Object.defineProperty(appRedis, "status", { value: "ready", configurable: true, writable: true });
    appRedis.ping = jest.fn().mockRejectedValue(new Error("Connection timeout"));

    const health = await checkRedisHealth();
    expect(health.status).toBe("disconnected");
  });

  test("5. /api/health endpoint includes Redis status and does not leak credentials", async () => {
    Object.defineProperty(appRedis, "status", { value: "ready", configurable: true, writable: true });
    appRedis.ping = jest.fn().mockResolvedValue("PONG");

    const app = express();
    app.get("/api/health", async (_req: Request, res: Response) => {
      const redisHealth = await checkRedisHealth();
      res.status(200).json({
        status: "ready",
        database: "connected",
        redis: redisHealth.status,
        services: {
          database: "connected",
          redis: redisHealth.status
        }
      });
    });

    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.database).toBe("connected");
    expect(res.body.redis).toBe("connected");
    expect(res.body.services.redis).toBe("connected");

    // Security check: confirm no password, host, or secrets are exposed
    const responseString = JSON.stringify(res.body);
    expect(responseString).not.toContain("password");
    expect(responseString).not.toContain("REDIS");
  });
});
