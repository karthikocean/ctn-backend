import "reflect-metadata";
import * as dotenv from "dotenv";

dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import {
  apiLimiter,
  mobileApiLimiter,
  adminApiLimiter,
  authLimiter,
  otpLimiter,
  passwordResetLimiter,
  uploadLimiter,
  paymentLimiter
} from "./middlewares/rateLimit.middleware";
import { useExpressServer } from "routing-controllers";
import { AppDataSource } from "./data-source";
import { Member } from "./entity/Member";
import { Connection } from "./entity/Connection";
import fileUpload from "express-fileupload";

// ✅ Swagger
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";
import { seedAdmin } from "./seed/seedAdmin";
import { seedModules } from "./seed/seedModules";
import { createServer } from "http";
import { initSocket } from "./utils/socket";
import { SubscriptionCronService } from "./services/subscriptionCron.service";
import { SpotlightCronService } from "./services/spotlightCron.service";
import { OnlineStallCronService } from "./services/onlineStallCron.service";
import { AnnouncementCronService } from "./services/announcementCron.service";
import { PostDeactivationCronService } from "./services/postDeactivationCron.service";
import { ReminderCronService } from "./services/reminderCron.service";
import { BirthdayCronService } from "./services/birthdayCron.service";
import { AnniversaryCronService } from "./services/anniversaryCron.service";
import { DailyTaskCronService } from "./services/dailyTaskCron.service";
import { SpotlightRequestCronService } from "./services/spotlightRequestCron.service";
import { MilestoneCronService } from "./services/milestoneCron.service";
import { MemberInactivityCronService } from "./services/memberInactivityCron.service";
import { DataRetentionCronService } from "./services/dataRetentionCron.service";
import { ensureMongoIndexes } from "./utils/ensureIndexes";
import { logger } from "./utils/logger";
import { checkRedisHealth } from "./config/appRedis";

// ─────────────────────────────────────────────────────────
// 🚀 STEP 1: Create app & HTTP server IMMEDIATELY
//    The port is open before the DB even connects.
// ─────────────────────────────────────────────────────────
let isReady = false;

const app = express();
// Enable trust proxy for reverse proxies / PM2 / Nginx / ALBs (correct client IP extraction)
app.set("trust proxy", 1);
app.disable("x-powered-by");

const PORT = process.env.PORT || 4000;
const httpServer = createServer(app);

// 🛡️ Security Headers (Helmet) registered first so all responses (including 503, 400, 404) carry security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Disabled for API & Swagger UI compatibility
    crossOriginEmbedderPolicy: false
  })
);

// Request Logger: Structured logs for incoming API requests
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const isError = statusCode >= 400;
    const msg = `${method} ${originalUrl} -> ${statusCode} (${duration}ms)`;
    if (isError) {
      logger.warn(msg, "API", { method, path: originalUrl, statusCode, durationMs: duration });
    } else {
      logger.info(msg, "API", { method, path: originalUrl, statusCode, durationMs: duration });
    }
  });

  next();
});

// Gate: return 503 while startup is in progress
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!isReady && req.path !== "/api/health" && req.path !== "/") {
    return res.status(503).json({
      success: false,
      message: "Server is starting up, please retry in a moment."
    });
  }
  next();
});

app.use(
  cors({
    origin: "*",  // ✅ Allow all domains
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "Content-Type", "Authorization"],
    credentials: false  // ⚠️ Must be false when origin is "*"
  })
);

const jsonBodyLimit = process.env.JSON_BODY_LIMIT || "10mb";
const urlencodedBodyLimit = process.env.URLENCODED_BODY_LIMIT || "10mb";

app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: urlencodedBodyLimit }));

app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: false
  })
);
app.use(express.static("public"));

// Health & root always respond instantly (bypasses rate limiters & 503 gate)
app.get("/api/health", async (_req: Request, res: Response) => {
  const redisHealth = await checkRedisHealth();
  const dbStatus = AppDataSource.isInitialized ? "connected" : "connecting";

  res.status(200).json({
    status: isReady ? "ready" : "starting",
    database: dbStatus,
    redis: redisHealth.status,
    services: {
      database: dbStatus,
      redis: redisHealth.status
    }
  });
});

app.get("/", async (_req: Request, res: Response) => {
  const redisHealth = await checkRedisHealth();
  res.status(200).json({
    status: isReady ? "ok" : "starting",
    timestamp: new Date().toISOString(),
    database: AppDataSource.isInitialized ? "connected" : "disconnected",
    redis: redisHealth.status,
    nodeVersion: process.version,
    uptime: process.uptime()
  });
});

// ─────────────────────────────────────────────────────────
// 🛡️ Route-Specific Rate Limiting Middleware
// ─────────────────────────────────────────────────────────
// Auth & Security Specific Limiters
app.use("/api/admin/auth/forgot-pin", passwordResetLimiter);
app.use("/api/admin/auth/verify-otp", otpLimiter);
app.use("/api/admin/auth/login", authLimiter);
app.use("/api/admin/auth", authLimiter);

app.use("/mobile-api/verification/send-otp", otpLimiter);
app.use("/mobile-api/verification/verify-otp", otpLimiter);
app.use("/mobile-api/auth/send-otp", otpLimiter);
app.use("/mobile-api/auth/verify-otp", otpLimiter);
app.use("/mobile-api/auth/login", authLimiter);
app.use("/mobile-api/auth/reset-pin", passwordResetLimiter);
app.use("/mobile-api/auth", authLimiter);

// File Upload & Import Limiters
app.use("/mobile-api/media/upload", uploadLimiter);
app.use("/api/admin/media/upload", uploadLimiter);
app.use("/api/admin/categories/import", uploadLimiter);
app.use("/api/admin/migrations", uploadLimiter);

// Payment & Subscription Limiters
app.use("/mobile-api/subscription/create-order", paymentLimiter);
app.use("/mobile-api/subscription/verify-payment", paymentLimiter);

// Scoped API Group Limiters
app.use("/mobile-api", mobileApiLimiter);
app.use("/api/admin", adminApiLimiter);
app.use("/api", apiLimiter);

import { setupBullBoard } from "./admin/bullboard.config";
import { registerGracefulShutdown } from "./utils/gracefulShutdown";

// ─────────────────────────────────────────────────────────
// 🚀 STEP 2: Bind to port IMMEDIATELY — accepts connections right away
// ─────────────────────────────────────────────────────────
initSocket(httpServer);

try {
  const bullBoardAdapter = setupBullBoard();
  app.use("/admin/queues", bullBoardAdapter.getRouter());
  console.log(`📊 Bull Board UI: http://localhost:${PORT}/admin/queues`);
} catch (err: any) {
  console.warn("⚠️ Bull Board initialization skipped:", err.message);
}

const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (starting up...)`);
  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_SWAGGER_IN_PROD === "true") {
    console.log(`📄 Swagger: http://localhost:${PORT}/api-docs`);
  }
});

// ✅ Register single, consolidated graceful shutdown handler for all termination signals
registerGracefulShutdown(server);

// ─────────────────────────────────────────────────────────
// 🔄 STEP 3: Connect DB & register routes in the background
// ─────────────────────────────────────────────────────────
AppDataSource.initialize()
  .then(async () => {
    console.log("✅ Database connected");

    // Ensure all @Index decorators are registered safely in MongoDB (idempotent, never drops data)
    try {
      const indexResult = await ensureMongoIndexes(AppDataSource);
      console.log(`📑 MongoDB indexes ensured: ${indexResult.totalIndexes} across ${indexResult.totalEntities} entities.`);
    } catch (indexErr) {
      console.warn("⚠️ Failed to ensure MongoDB indexes on startup:", indexErr);
    }

    // ✅ Swagger route — enabled in non-production or when explicitly requested via ENABLE_SWAGGER_IN_PROD
    if (process.env.NODE_ENV !== "production" || process.env.ENABLE_SWAGGER_IN_PROD === "true") {
      app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
      console.log(`📚 Swagger UI available at /api-docs (NODE_ENV=${process.env.NODE_ENV})`);
    }

    const ext = __filename.endsWith(".ts") ? "ts" : "js";

    // ✅ Admin APIs
    useExpressServer(app, {
      routePrefix: "/api/admin",
      controllers: [__dirname + `/controllers/admin/*.${ext}`],
      middlewares: [__dirname + `/middlewares/**/*.${ext}`],
      interceptors: [__dirname + `/middlewares/ResponseInterceptor.${ext}`],
      defaultErrorHandler: false,
      validation: true,
      classTransformer: true
    });

    // ✅ Mobile APIs
    useExpressServer(app, {
      routePrefix: "/mobile-api",
      controllers: [__dirname + `/controllers/mobile/*.${ext}`],
      middlewares: [__dirname + `/middlewares/**/*.${ext}`],
      interceptors: [__dirname + `/middlewares/ResponseInterceptor.${ext}`],
      defaultErrorHandler: false,
      validation: true,
      classTransformer: true
    });

    // ✅ Website APIs
    useExpressServer(app, {
      routePrefix: "/website-api",
      controllers: [__dirname + `/controllers/website/*.${ext}`],
      middlewares: [__dirname + `/middlewares/**/*.${ext}`],
      interceptors: [__dirname + `/middlewares/ResponseInterceptor.${ext}`],
      defaultErrorHandler: false,
      validation: true,
      classTransformer: true
    });

    // ✅ Common / General APIs
    useExpressServer(app, {
      routePrefix: "/api",
      controllers: [__dirname + `/controllers/*.${ext}`],
      middlewares: [__dirname + `/middlewares/**/*.${ext}`],
      interceptors: [__dirname + `/middlewares/ResponseInterceptor.${ext}`],
      defaultErrorHandler: false,
      validation: true,
      classTransformer: true
    });

    // Global error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      logger.error(`Global error caught: ${err.message || String(err)}`, err, "GlobalErrorHandler");
      const isProd = process.env.NODE_ENV === "production";
      const statusCode = err.status || err.statusCode || err.httpCode || 500;
      if (err.type === "entity.too.large" || statusCode === 413) {
        return res.status(413).json({
          status: "error",
          message: "Payload Too Large: Request body exceeds maximum allowed limit."
        });
      }
      res.status(statusCode).json({
        message: isProd ? "An unexpected error occurred." : err.message,
        errors: isProd ? null : err.errors || null
      });
    });

    // ✅ Mark server as ready — 503 gate is lifted, all API traffic flows normally
    isReady = true;
    console.log("✅ Server is ready — accepting API requests");

    // ─────────────────────────────────────────────────────
    // 🔄 Background tasks (non-blocking, after ready)
    // ─────────────────────────────────────────────────────
    setImmediate(async () => {
      try {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        await memberRepo.updateMany({}, { $set: { isOnline: false } });
        console.log("🔄 Reset all members to offline status on startup");

        const connectionRepo = AppDataSource.getMongoRepository(Connection);
        await connectionRepo.updateMany(
          { isDeleted: { $exists: false } } as any,
          { $set: { isDeleted: false } } as any
        );
        console.log("🔄 Updated all existing connections to isDeleted: false");
      } catch (err) {
        console.error("❌ Failed to reset members' online status or update connections on startup:", err);
      }

      try {
        await seedModules();
        await seedAdmin();
      } catch (err) {
        console.error("❌ Seeding error:", err);
      }

      // Initialize Cron Jobs
      SubscriptionCronService.init();
      SpotlightCronService.init();
      OnlineStallCronService.init();
      AnnouncementCronService.init();
      PostDeactivationCronService.init();
      ReminderCronService.init();
      BirthdayCronService.init();
      AnniversaryCronService.init();
      DailyTaskCronService.init();
      SpotlightRequestCronService.init();
      MilestoneCronService.init();
      MemberInactivityCronService.init();
      DataRetentionCronService.init();
    });
  })
  .catch((error) => {
    console.error("❌ DB Error:", error);
  });
