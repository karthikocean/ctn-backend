import "reflect-metadata";
import * as dotenv from "dotenv";

dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { useExpressServer } from "routing-controllers";
import { AppDataSource } from "./data-source";
import fileUpload from "express-fileupload";

// ✅ Swagger
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";
import { seedAdmin } from "./seed/seedAdmin";
import { createServer } from "http";
import { initSocket, getIO, waitForDisconnects } from "./utils/socket";
import { SubscriptionCronService } from "./services/subscriptionCron.service";
import { DailyScoreCronService } from "./services/dailyScoreCron.service";
import { SpotlightCronService } from "./services/spotlightCron.service";
import { OnlineStallCronService } from "./services/onlineStallCron.service";

AppDataSource.initialize()
  .then(async () => {
    console.log("✅ Database connected");

    const app = express();
    // seed default admin user
    await seedAdmin();
    // seed default subscription plans
    // await seedPlans();
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
        limits: { fileSize: 50 * 1024 * 1024 }, // ✅ Increased to 50MB to match MediaController
        abortOnLimit: true,
        useTempFiles: false
      })
    );
    app.use(express.static("public"));

    // ✅ Swagger route
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
    app.get("/api/health", (req, res) => {
      res.status(200).send("Server is alive");
    });

    app.get("/", (_req, res) => {

      res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        database: AppDataSource.isInitialized ? "connected" : "disconnected",
        nodeVersion: process.version,
        uptime: process.uptime()
      });
    });
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      const isProd = process.env.NODE_ENV === "production";
      res.status(err.httpCode || 500).json({
        message: isProd ? "An unexpected error occurred." : err.message,
        errors: isProd ? null : err.errors || null
      });
    });

    const PORT = process.env.PORT || 4000;

    const httpServer = createServer(app);
    initSocket(httpServer);
    const server = httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📄 Swagger: http://localhost:${PORT}/api-docs`);

      // Initialize Subscription Daily Cron Job
      SubscriptionCronService.init();

      // Initialize Daily Score Cron Jobs
      DailyScoreCronService.init();
      SpotlightCronService.init();
      OnlineStallCronService.init();

    });

    // ✅ Graceful Shutdown Handlers
    const closeServer = async () => {
      console.log("Shutting down server...");

      try {
        const io = getIO();
        if (io) {
          console.log("Closing Socket.io server and disconnecting clients...");
          io.close();
          // Wait for any active disconnect DB writes to complete before closing the DB
          await waitForDisconnects(2000);
        }
      } catch (err) {
        console.log("Socket.io server was not initialized or already closed.");
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

  })
  .catch((error) => {
    console.error("❌ DB Error:", error);
  });
