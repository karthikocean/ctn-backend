/**
 * Structured Production Logger for CTN Backend
 *
 * Supports JSON structured logging in production and readable formatting in development.
 * Automatically sanitizes sensitive credentials, tokens, OTPs, and passwords.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 3,
  info: 2,
  warn: 1,
  error: 0
};

const SENSITIVE_KEYS = new Set([
  "password",
  "pin",
  "otp",
  "token",
  "refreshtoken",
  "accesstoken",
  "secret",
  "jwtsecret",
  "jwt_secret",
  "authorization",
  "cookie",
  "cvv",
  "cardnumber",
  "card_number",
  "razorpaysignature",
  "razorpay_signature",
  "apikey",
  "api_key",
  "privatekey",
  "private_key"
]);

/**
 * Recursively redacts sensitive keys from log metadata objects.
 */
export function sanitizeLogData(data: any, depth = 0, maxDepth = 4, seen = new WeakSet()): any {
  if (depth > maxDepth || data === null || data === undefined) {
    return data;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (seen.has(data)) {
    return "[Circular]";
  }
  seen.add(data);

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: process.env.NODE_ENV === "production" ? undefined : data.stack
    };
  }

  if (Array.isArray(data)) {
    return data.slice(0, 50).map((item) => sanitizeLogData(item, depth + 1, maxDepth, seen));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const rawLowerKey = key.toLowerCase();
    const strippedLowerKey = rawLowerKey.replace(/[-_]/g, "");
    if (SENSITIVE_KEYS.has(strippedLowerKey) || SENSITIVE_KEYS.has(rawLowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeLogData(value, depth + 1, maxDepth, seen);
    }
  }

  return sanitized;
}

class Logger {
  private get configuredLevel(): LogLevel {
    const envLevel = (process.env.LOG_LEVEL || "").toLowerCase() as LogLevel;
    if (envLevel in LOG_LEVELS) {
      return envLevel;
    }
    return process.env.NODE_ENV === "production" ? "info" : "debug";
  }

  private isLevelEnabled(level: LogLevel): boolean {
    const currentWeight = LOG_LEVELS[this.configuredLevel] ?? 2;
    const targetWeight = LOG_LEVELS[level] ?? 2;
    return targetWeight <= currentWeight;
  }

  private write(level: LogLevel, message: string, context?: string, meta?: any) {
    if (!this.isLevelEnabled(level)) return;

    const timestamp = new Date().toISOString();
    const isProd = process.env.NODE_ENV === "production";
    const cleanMeta = meta !== undefined ? sanitizeLogData(meta) : undefined;

    if (isProd || process.env.LOG_FORMAT === "json") {
      const logObject: Record<string, any> = {
        timestamp,
        level,
        context: context || "App",
        message
      };

      if (cleanMeta !== undefined) {
        logObject.meta = cleanMeta;
      }

      const jsonStr = JSON.stringify(logObject);
      if (level === "error") {
        console.error(jsonStr);
      } else if (level === "warn") {
        console.warn(jsonStr);
      } else {
        console.log(jsonStr);
      }
    } else {
      const prefix = `[${timestamp}] [${level.toUpperCase()}]${context ? ` [${context}]` : ""}`;
      if (level === "error") {
        console.error(`${prefix} ${message}`, cleanMeta || "");
      } else if (level === "warn") {
        console.warn(`${prefix} ${message}`, cleanMeta || "");
      } else {
        console.log(`${prefix} ${message}`, cleanMeta || "");
      }
    }
  }

  info(message: string, context?: string, meta?: any) {
    this.write("info", message, context, meta);
  }

  warn(message: string, context?: string, meta?: any) {
    this.write("warn", message, context, meta);
  }

  error(message: string, error?: any, context?: string, meta?: any) {
    const mergedMeta = {
      ...(meta || {}),
      ...(error ? { error: error instanceof Error ? { name: error.name, message: error.message } : error } : {})
    };
    this.write("error", message, context, mergedMeta);
  }

  debug(message: string, context?: string, meta?: any) {
    this.write("debug", message, context, meta);
  }

  child(context: string) {
    return {
      info: (msg: string, meta?: any) => this.info(msg, context, meta),
      warn: (msg: string, meta?: any) => this.warn(msg, context, meta),
      error: (msg: string, err?: any, meta?: any) => this.error(msg, err, context, meta),
      debug: (msg: string, meta?: any) => this.debug(msg, context, meta)
    };
  }
}

export const logger = new Logger();
export default logger;
