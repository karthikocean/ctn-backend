import { AppDataSource } from "../data-source";
import { RequestLog } from "../entity/RequestLog";
import { ObjectId } from "mongodb";
import { logger } from "../utils/logger";

const SENSITIVE_KEY_REGEX = /(?:password|pin|mpin|old_?pin|new_?pin|confirm_?pin|otp|token|access_?token|refresh_?token|jwt|auth(?:orization)?|secret|cookie|credit_?card|cvv|cvc)/i;

export interface LogFilterOptions {
  page?: number;
  limit?: number;
  userId?: string;
  method?: string;
  statusCode?: number;
  path?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  ipAddress?: string;
}

export class RequestLogService {
  private static get repository() {
    return AppDataSource.getMongoRepository(RequestLog);
  }

  /**
   * Sanitizes payload, query, or headers recursively to mask sensitive fields
   * (e.g. passwords, PINs, tokens, secrets, OTPs) and prevent overly large objects.
   */
  public static sanitizeData(data: any, currentDepth = 0): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (currentDepth > 5) {
      return "[Max Depth Reached]";
    }

    if (typeof data === "string") {
      // Truncate overly long strings (e.g. raw base64 or file uploads)
      if (data.length > 2048) {
        return `${data.substring(0, 512)}... [Truncated: ${data.length} chars]`;
      }
      return data;
    }

    if (typeof data === "number" || typeof data === "boolean") {
      return data;
    }

    if (Buffer.isBuffer(data)) {
      return `[Binary Buffer: ${data.length} bytes]`;
    }

    if (Array.isArray(data)) {
      // Limit array entries to prevent gigantic documents
      if (data.length > 50) {
        const sliced = data.slice(0, 50).map((item) => this.sanitizeData(item, currentDepth + 1));
        sliced.push(`[Truncated: ${data.length - 50} more items]`);
        return sliced;
      }
      return data.map((item) => this.sanitizeData(item, currentDepth + 1));
    }

    if (typeof data === "object") {
      const sanitized: Record<string, any> = {};
      const keys = Object.keys(data);

      for (const key of keys) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
          sanitized[key] = "***REDACTED***";
        } else {
          try {
            sanitized[key] = this.sanitizeData(data[key], currentDepth + 1);
          } catch {
            sanitized[key] = "[Unserializable Field]";
          }
        }
      }
      return sanitized;
    }

    return String(data);
  }

  /**
   * Asynchronously stores a complete request data model in MongoDB.
   * Execution is fully non-blocking and safe: any database error is caught
   * and logged without interrupting user request flow or client responses.
   */
  public static async storeRequestLog(logData: {
    method: string;
    url: string;
    path?: string;
    ipAddress?: string;
    payload?: any;
    query?: any;
    params?: any;
    headers?: any;
    statusCode?: number;
    durationMs?: number;
    userId?: string | ObjectId;
    userType?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      if (!AppDataSource.isInitialized) {
        // DataSource not ready yet (e.g. early startup probe)
        return;
      }

      const log = new RequestLog();
      log.method = (logData.method || "UNKNOWN").toUpperCase();
      log.url = logData.url || "";
      log.path = logData.path || (logData.url ? logData.url.split("?")[0] : "");
      log.ipAddress = logData.ipAddress || "";
      log.statusCode = logData.statusCode;
      log.durationMs = logData.durationMs;
      log.userType = logData.userType;
      log.errorMessage = logData.errorMessage;

      // Normalize userId
      if (logData.userId) {
        const userIdStr = typeof logData.userId === "string" ? logData.userId : logData.userId.toString();
        log.userIdStr = userIdStr;
        if (ObjectId.isValid(userIdStr)) {
          log.userId = new ObjectId(userIdStr);
        }
      }

      // Sanitize body/payload
      if (logData.payload !== undefined) {
        log.payload = this.sanitizeData(logData.payload);
      }

      // Sanitize query params
      if (logData.query && Object.keys(logData.query).length > 0) {
        log.query = this.sanitizeData(logData.query);
      }

      // Sanitize route params
      if (logData.params && Object.keys(logData.params).length > 0) {
        log.params = this.sanitizeData(logData.params);
      }

      // Filter and sanitize relevant request headers
      if (logData.headers) {
        const safeHeaders: Record<string, any> = {};
        const allowedHeaders = [
          "user-agent",
          "accept",
          "content-type",
          "host",
          "origin",
          "referer",
          "x-forwarded-for",
          "x-platform",
          "app-version"
        ];

        for (const h of allowedHeaders) {
          if (logData.headers[h]) {
            safeHeaders[h] = logData.headers[h];
          }
        }
        log.headers = safeHeaders;
      }

      log.createdAt = new Date();

      // Non-blocking fire-and-forget insert
      await this.repository.save(log);
    } catch (error: any) {
      logger.warn(`Failed to store request log: ${error.message || String(error)}`, "RequestLogService");
    }
  }

  /**
   * Permanently deletes request logs older than the specified retention period.
   * Can be invoked manually or scheduled via DataRetentionCronService.
   *
   * @param retentionDays Number of days to retain logs (defaults to REQUEST_LOG_RETENTION_DAYS or 30 days)
   * @returns Count of permanently deleted log records
   */
  public static async cleanupExpiredLogs(retentionDays?: number): Promise<{
    deletedCount: number;
    cutoffDate: Date;
    retentionDays: number;
  }> {
    const days = retentionDays && retentionDays > 0
      ? retentionDays
      : (process.env.REQUEST_LOG_RETENTION_DAYS ? parseInt(process.env.REQUEST_LOG_RETENTION_DAYS, 10) : 30);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    console.log(`[RequestLogCleanup] Permanently purging request logs created before ${cutoffDate.toISOString()} (${days} days retention)...`);

    try {
      const result = await this.repository.deleteMany({
        createdAt: { $lte: cutoffDate }
      } as any);

      const deletedCount = result.deletedCount || 0;
      console.log(`✅ [RequestLogCleanup] Successfully deleted ${deletedCount} expired request log(s).`);

      return {
        deletedCount,
        cutoffDate,
        retentionDays: days
      };
    } catch (error: any) {
      console.error("❌ [RequestLogCleanup] Error deleting expired request logs:", error.message || error);
      throw error;
    }
  }

  /**
   * Retrieves request logs with pagination and flexible filters.
   */
  public static async getLogs(filter: LogFilterOptions): Promise<{
    data: RequestLog[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(0, Number(filter.page) || 0);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));

    const query: any = {};

    if (filter.userId) {
      if (ObjectId.isValid(filter.userId)) {
        query.$or = [
          { userId: new ObjectId(filter.userId) },
          { userIdStr: filter.userId }
        ];
      } else {
        query.userIdStr = filter.userId;
      }
    }

    if (filter.method) {
      query.method = filter.method.toUpperCase();
    }

    if (filter.statusCode) {
      query.statusCode = Number(filter.statusCode);
    }

    if (filter.path) {
      query.path = { $regex: filter.path, $options: "i" };
    }

    if (filter.ipAddress) {
      query.ipAddress = filter.ipAddress;
    }

    if (filter.startDate || filter.endDate) {
      query.createdAt = {};
      if (filter.startDate) {
        query.createdAt.$gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        query.createdAt.$lte = new Date(filter.endDate);
      }
    }

    const [data, total] = await this.repository.findAndCount({
      where: query,
      order: { createdAt: "DESC" },
      skip: page * limit,
      take: limit
    });

    return { data, total, page, limit };
  }

  /**
   * Retrieves aggregate statistics of request logs.
   */
  public static async getStats(): Promise<{
    totalLogs: number;
    errorCount: number;
    successCount: number;
  }> {
    const totalLogs = await this.repository.count();
    const errorCount = await this.repository.count({
      where: { statusCode: { $gte: 400 } } as any
    });
    const successCount = totalLogs - errorCount;

    return {
      totalLogs,
      errorCount,
      successCount
    };
  }
}
