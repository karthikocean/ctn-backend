/**
 * Tests for Express JSON & URL-Encoded Body Size Limits (P2-3)
 */

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

describe("Express Body Size Limit Security (P2-3)", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();

    // Configure a small 50kb limit for the test application
    const jsonLimit = "50kb";
    const urlencodedLimit = "50kb";

    app.use(express.json({ limit: jsonLimit }));
    app.use(express.urlencoded({ extended: true, limit: urlencodedLimit }));

    app.post("/test-json", (req: Request, res: Response) => {
      res.status(200).json({ success: true, receivedBytes: JSON.stringify(req.body).length });
    });

    app.post("/test-urlencoded", (req: Request, res: Response) => {
      res.status(200).json({ success: true, data: req.body });
    });

    // Global error handler matching index.ts
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const statusCode = err.status || err.statusCode || err.httpCode || 500;
      if (err.type === "entity.too.large" || statusCode === 413) {
        return res.status(413).json({
          status: "error",
          message: "Payload Too Large: Request body exceeds maximum allowed limit."
        });
      }
      res.status(statusCode).json({
        message: err.message
      });
    });
  });

  test("1. Allows normal JSON payload below size limit", async () => {
    const smallPayload = { name: "Trusted Network", message: "Hello World" };

    const res = await request(app)
      .post("/test-json")
      .send(smallPayload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("2. Rejects oversized JSON payload above limit with HTTP 413", async () => {
    // Generate a payload larger than 50kb
    const largeData = "x".repeat(60 * 1024);
    const largePayload = { data: largeData };

    const res = await request(app)
      .post("/test-json")
      .send(largePayload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      status: "error",
      message: "Payload Too Large: Request body exceeds maximum allowed limit."
    });
  });

  test("3. Allows URL-encoded payload below size limit", async () => {
    const res = await request(app)
      .post("/test-urlencoded")
      .send("title=Test&description=Sample")
      .set("Content-Type", "application/x-www-form-urlencoded");

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Test");
  });

  test("4. Rejects oversized URL-encoded payload above limit with HTTP 413", async () => {
    const largeForm = "key=" + "a".repeat(60 * 1024);

    const res = await request(app)
      .post("/test-urlencoded")
      .send(largeForm)
      .set("Content-Type", "application/x-www-form-urlencoded");

    expect(res.status).toBe(413);
    expect(res.body.status).toBe("error");
  });
});
