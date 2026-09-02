/**
 * Tests for Helmet Middleware Ordering & Security Headers (P2-9)
 */

import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import request from "supertest";

describe("Helmet Middleware Ordering & Security Headers (P2-9)", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable("x-powered-by");

    // 1. Helmet registered first
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
      })
    );

    // 2. CORS
    app.use(
      cors({
        origin: "*",
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Origin", "Content-Type", "Authorization"],
        credentials: false
      })
    );

    // 3. Body parsers
    app.use(express.json());

    // Routes
    app.get("/api/test-secure", (_req: Request, res: Response) => {
      res.status(200).json({ success: true, message: "Secure endpoint" });
    });

    app.get("/api/test-error", (_req: Request, _res: Response) => {
      throw new Error("Simulated Server Error");
    });

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ success: false, message: err.message });
    });
  });

  test("1. Standard 200 OK response contains Helmet security headers and no x-powered-by", async () => {
    const res = await request(app).get("/api/test-secure");

    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
    expect(res.headers["x-download-options"]).toBe("noopen");
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("2. 404 Not Found response still carries Helmet security headers", async () => {
    const res = await request(app).get("/non-existent-route");

    expect(res.status).toBe(404);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("3. 500 Error response still carries Helmet security headers", async () => {
    const res = await request(app).get("/api/test-error");

    expect(res.status).toBe(500);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("4. Helmet security headers and CORS headers coexist on OPTIONS preflight", async () => {
    const res = await request(app)
      .options("/api/test-secure")
      .set("Origin", "https://admin.trustednetwork.in")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
});
