import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

/**
 * Default log retention in days (fallback: 30 days).
 * Can be overridden via REQUEST_LOG_RETENTION_DAYS environment variable.
 */
const DEFAULT_RETENTION_DAYS = process.env.REQUEST_LOG_RETENTION_DAYS
  ? parseInt(process.env.REQUEST_LOG_RETENTION_DAYS, 10)
  : 30;

export const REQUEST_LOG_RETENTION_SECONDS = Math.max(1, DEFAULT_RETENTION_DAYS) * 24 * 60 * 60;

@Entity("request_logs")
@Index(["createdAt"], { expireAfterSeconds: REQUEST_LOG_RETENTION_SECONDS })
@Index(["userId"])
@Index(["userIdStr"])
@Index(["method"])
@Index(["path"])
@Index(["statusCode"])
@Index(["ipAddress"])
export class RequestLog {
  @ObjectIdColumn()
    _id!: ObjectId;

  /**
   * MongoDB ObjectId of the user making the request (if authenticated with valid ObjectId)
   */
  @Column({ nullable: true })
    userId?: ObjectId;

  /**
   * String representation of userId for fast search and for non-ObjectId identifiers
   */
  @Column({ nullable: true })
    userIdStr?: string;

  /**
   * Type or role of the user (e.g. ADMIN, ADMIN_USER, MEMBER, GUEST)
   */
  @Column({ nullable: true })
    userType?: string;

  /**
   * HTTP Method (GET, POST, PUT, PATCH, DELETE, OPTIONS, etc.)
   */
  @Column()
    method!: string;

  /**
   * Full requested URL including query parameters
   */
  @Column()
    url!: string;

  /**
   * Base route path without query parameters
   */
  @Column({ nullable: true })
    path?: string;

  /**
   * Client IP address (considers proxies, Cloudflare, ALBs, etc.)
   */
  @Column({ nullable: true })
    ipAddress?: string;

  /**
   * Request payload/body (sanitized with sensitive data like passwords/pins redacted)
   */
  @Column({ nullable: true })
    payload?: any;

  /**
   * Query parameters from the request
   */
  @Column({ nullable: true })
    query?: any;

  /**
   * Route parameters from the request
   */
  @Column({ nullable: true })
    params?: any;

  /**
   * Safe headers (user-agent, referer, accept, content-type, host, etc.)
   */
  @Column({ nullable: true })
    headers?: any;

  /**
   * HTTP status code returned to client (e.g. 200, 201, 400, 401, 500)
   */
  @Column({ nullable: true })
    statusCode?: number;

  /**
   * Total response time in milliseconds
   */
  @Column({ nullable: true })
    durationMs?: number;

  /**
   * Error message or details if request failed (status >= 400)
   */
  @Column({ nullable: true })
    errorMessage?: string;

  /**
   * Creation timestamp. TTL index on this column will permanently delete the log
   * after REQUEST_LOG_RETENTION_SECONDS.
   */
  @CreateDateColumn()
    createdAt!: Date;
}
