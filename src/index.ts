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
import fileUpload from "express-fileupload";

// ✅ Swagger
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";
import { seedAdmin } from "./seed/seedAdmin";
import { seedModules } from "./seed/seedModules";
// import { migrateRegions } from "./migrations/migrateRegions";
import { createServer } from "http";
import { initSocket, getIO, waitForDisconnects } from "./utils/socket";
import { SubscriptionCronService } from "./services/subscriptionCron.service";
// import { DailyScoreCronService } from "./services/dailyScoreCron.service";
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
// import { migrateRegions } from "./migrations/migrateRegions";

// ─────────────────────────────────────────────────────────
// 🚀 STEP 1: Create app & HTTP server IMMEDIATELY
//    The port is open before the DB even connects.
// ─────────────────────────────────────────────────────────
let isReady = false;

const app = express();
// Enable trust proxy for reverse proxies / PM2 / Nginx / ALBs (correct client IP extraction)
app.set("trust proxy", 1);

const PORT = process.env.PORT || 4000;
const httpServer = createServer(app);

// Request Logger: Logs incoming API requests and endpoints in the terminal
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const icon = statusCode >= 400 ? "❌" : "🌐";
    console.log(`${icon} [API] ${method} ${originalUrl} -> ${statusCode} (${duration}ms)`);
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

app.use(express.json());

app.use(
  cors({
    origin: "*",  // ✅ Allow all domains
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "Content-Type", "Authorization"],
    credentials: false  // ⚠️ Must be false when origin is "*"
  })
);

app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: false
  })
);
app.use(express.static("public"));
app.use(helmet());

// Health & root always respond instantly (bypasses rate limiters & 503 gate)
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: isReady ? "ready" : "starting",
    database: AppDataSource.isInitialized ? "connected" : "connecting"
  });
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    status: isReady ? "ok" : "starting",
    timestamp: new Date().toISOString(),
    database: AppDataSource.isInitialized ? "connected" : "disconnected",
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

registerGracefulShutdown();

const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (starting up...)`);
  console.log(`📄 Swagger: http://localhost:${PORT}/api-docs`);
});

// ─────────────────────────────────────────────────────────
// ✅ Graceful Shutdown
// ─────────────────────────────────────────────────────────
const closeServer = async () => {
  console.log("Shutting down server...");
  try {
    const io = getIO();
    if (io) {
      console.log("Closing Socket.io server and disconnecting clients...");
      io.close();
      await waitForDisconnects(2000);
    }
  } catch (err) {
    console.log("Socket.io server was not initialized or already closed.", err);
  }
  server.close(async () => {
    console.log("Server closed.");
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log("Database connection closed.");
    }
    process.exit(0);
  });
};

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
process.on("SIGUSR2", closeServer); // For nodemon restarts

// ─────────────────────────────────────────────────────────
// 🔄 STEP 3: Connect DB & register routes in the background
// ─────────────────────────────────────────────────────────
AppDataSource.initialize()
  .then(async () => {
    console.log("✅ Database connected");

    // ✅ Swagger route — only available in non-production environments
    if (process.env.NODE_ENV !== "production") {
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
      console.error(err);
      const isProd = process.env.NODE_ENV === "production";
      res.status(err.httpCode || 500).json({
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
      } catch (err) {
        console.error("❌ Failed to reset members' online status on startup:", err);
      }

      try {
        await seedModules();
        await seedAdmin();
      } catch (err) {
        console.error("❌ Seeding error:", err);
      }

      // Initialize Cron Jobs
      SubscriptionCronService.init();
      // DailyScoreCronService.init();
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
    });
  })
  .catch((error) => {
    console.error("❌ DB Error:", error);
  });
