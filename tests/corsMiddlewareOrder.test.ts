/**
 * Tests for Express JSON Parser Ordering vs CORS (P3-6)
 */

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import request from "supertest";

describe("CORS & Body Parser Middleware Ordering (P3-6)", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();

    // 1. CORS registered BEFORE body parsers
    app.use(
      cors({
        origin: "*",
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Origin", "Content-Type", "Authorization"],
        credentials: false
      })
    );

    // 2. Body parsers
    app.use(express.json({ limit: "1kb" }));
    app.use(express.urlencoded({ extended: true, limit: "1kb" }));

    // Routes
    app.post("/test-json", (req: Request, res: Response) => {
      res.status(200).json({ success: true, data: req.body });
    });

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.status || 500).json({
        success: false,
        error: err.type || err.name || "Error",
        message: err.message
      });
    });
  });

  test("1. Normal JSON POST includes CORS headers", async () => {
    const res = await request(app)
      .post("/test-json")
      .set("Origin", "https://admin.trustednetwork.in")
      .send({ name: "Test User" });

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Test User");
  });

  test("2. OPTIONS preflight request returns CORS headers immediately", async () => {
    const res = await request(app)
      .options("/test-json")
      .set("Origin", "https://admin.trustednetwork.in")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type, Authorization");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  test("3. Malformed JSON returns 400 Bad Request WITH CORS headers intact", async () => {
    const res = await request(app)
      .post("/test-json")
      .set("Origin", "https://admin.trustednetwork.in")
      .set("Content-Type", "application/json")
      .send('{"invalidJson": unquoted}');

    expect(res.status).toBe(400);
    // Crucial check: CORS header must be present so browser doesn't obscure the 400 error
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body.success).toBe(false);
  });

  test("4. Payload too large (413) returns WITH CORS headers intact", async () => {
    const largeData = "A".repeat(2048); // exceeds 1kb limit
    const res = await request(app)
      .post("/test-json")
      .set("Origin", "https://admin.trustednetwork.in")
      .send({ data: largeData });

    expect(res.status).toBe(413);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body.success).toBe(false);
  });
});
