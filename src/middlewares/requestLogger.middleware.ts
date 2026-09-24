import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { RequestLogService } from "../services/requestLog.service";

/**
 * Paths that should NOT be recorded in the database to prevent noise and high disk churn
 */
const IGNORED_PATH_PREFIXES = [
  "/api/health",
  "/favicon.ico",
  "/admin/queues",
  "/api-docs",
  "/public"
];

const IGNORED_EXTENSIONS = /\.(?:css|js|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i;

/**
 * Resolves the client IP address from request headers, proxy forwarders, or socket
 */
function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const firstIp = forwarded[0].split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  if (req.headers["x-real-ip"] && typeof req.headers["x-real-ip"] === "string") {
    return req.headers["x-real-ip"].trim();
  }
  if (req.ip) {
    return req.ip;
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return "unknown";
}

/**
 * Attempts to extract userId from authenticated request or decode from Authorization Bearer token
 */
function extractUserIdAndType(req: Request): { userId?: string; userType?: string } {
  const anyReq = req as any;

  // 1. Direct user object attached by AuthMiddleware or MobileAuthMiddleware
  if (anyReq.user) {
    const u = anyReq.user;
    const userId = u.userId || u.id || u._id || (typeof u.toString === "function" ? u.toString() : undefined);
    const userType = u.userType || (typeof u.role === "string" ? u.role : u.role?.name);
    if (userId) {
      return { userId: String(userId), userType };
    }
  }

  // 2. Direct userId property on request
  if (anyReq.userId) {
    return { userId: String(anyReq.userId), userType: anyReq.userType };
  }

  // 3. Fallback: decode JWT token from Authorization header if present
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.decode(token) as any;
        if (decoded && typeof decoded === "object") {
          const userId = decoded.userId || decoded.id || decoded._id;
          const userType = decoded.userType || (typeof decoded.role === "string" ? decoded.role : decoded.role?.name);
          if (userId) {
            return { userId: String(userId), userType };
          }
        }
      } catch {
        // Ignore JWT decode errors in logging middleware
      }
    }
  }

  return {};
}

/**
 * Middleware that captures complete request details (method, url, ipAddress, payload, userId)
 * and stores them in MongoDB via RequestLogService.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check if request logging is disabled via environment variable
  if (process.env.ENABLE_REQUEST_LOGGING === "false") {
    return next();
  }

  const path = req.path || req.originalUrl.split("?")[0];

  // Skip static files, health checks, swagger, and queue dashboard
  if (
    path === "/" ||
    IGNORED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    IGNORED_EXTENSIONS.test(path)
  ) {
    return next();
  }

  const start = Date.now();
  const method = req.method;
  const originalUrl = req.originalUrl || req.url;
  const ipAddress = extractClientIp(req);

  // Hook into response finish event to capture complete request + response metadata
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;

    // Extract user info (from auth middleware or JWT header)
    const { userId, userType } = extractUserIdAndType(req);

    // Prepare payload (body + file uploads metadata if any)
    let payload: any = req.body;

    const anyReq = req as any;
    if (anyReq.files && Object.keys(anyReq.files).length > 0) {
      const filesSummary: Record<string, any> = {};
      for (const [key, val] of Object.entries(anyReq.files)) {
        if (Array.isArray(val)) {
          filesSummary[key] = val.map((f: any) => ({
            name: f.name,
            size: f.size,
            mimetype: f.mimetype
          }));
        } else if (val && typeof val === "object") {
          const f = val as any;
          filesSummary[key] = {
            name: f.name,
            size: f.size,
            mimetype: f.mimetype
          };
        }
      }

      if (payload && typeof payload === "object") {
        payload = { ...payload, _uploadedFiles: filesSummary };
      } else {
        payload = { _uploadedFiles: filesSummary };
      }
    }

    // Capture error message from locals or response if status code is an error
    let errorMessage: string | undefined = undefined;
    if (statusCode >= 400 && (res as any).locals?.errorMessage) {
      errorMessage = String((res as any).locals.errorMessage);
    }

    // Fire-and-forget async log store (non-blocking)
    setImmediate(() => {
      RequestLogService.storeRequestLog({
        method,
        url: originalUrl,
        path,
        ipAddress,
        payload,
        query: req.query,
        params: req.params,
        headers: req.headers,
        statusCode,
        durationMs,
        userId,
        userType,
        errorMessage
      });
    });
  });

  next();
}
