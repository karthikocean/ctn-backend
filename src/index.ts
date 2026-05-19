import "reflect-metadata";
import * as dotenv from "dotenv";

dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { useExpressServer } from "routing-controllers";
import { AppDataSource } from "./data-source";
import fileUpload from "express-fileupload";
import { Spotlight, SpotlightStatus } from "./entity/Spotlight";

// ✅ Swagger
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";
import { seedAdmin } from "./seed/seedAdmin";
import { createServer } from "http";
import { initSocket } from "./utils/socket";
import cron from "node-cron";
import axios from "axios";

AppDataSource.initialize()
  .then(async () => {
    console.log("✅ Database connected");

    const app = express();
    // seed default admin user
    await seedAdmin();
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

      // ✅ Cron job to call the production URL every 5 minutes to keep it alive
      cron.schedule("*/5 * * * *", async () => {
        try {
          const url = "https://ctn-backend.onrender.com/api/health";
          const response = await axios.get(url);
          console.log(`🕒 Cron Health Check: ${response.data} at ${new Date().toLocaleString()}`);
        } catch (error: any) {
          console.error(`❌ Cron Health Check Failed: ${error.message}`);
        }
      });

      // ✅ Spotlight Activation Cron - Runs every day at 12:01 AM
      cron.schedule("1 0 * * *", async () => {
        try {
          console.log("🕒 Running Spotlight Activation Cron...");
          const spotlightRepo = AppDataSource.getMongoRepository(Spotlight);

          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date();
          todayEnd.setHours(23, 59, 59, 999);

          const result = await spotlightRepo.updateMany(
            {
              scheduleDate: { $gte: todayStart, $lte: todayEnd },
              status: SpotlightStatus.SCHEDULE,
              isDeleted: false
            },
            { $set: { status: SpotlightStatus.ACTIVE } }
          );

          console.log(`✅ Spotlight Activation: ${result.modifiedCount} records set to active.`);
        } catch (error: any) {
          console.error(`❌ Spotlight Activation Cron Failed: ${error.message}`);
        }
      });

      // ✅ Spotlight Deactivation Cron - Runs every minute
      cron.schedule("* * * * *", async () => {
        try {
          const spotlightRepo = AppDataSource.getMongoRepository(Spotlight);

          const now = new Date();

          const result = await spotlightRepo.updateMany(
            {
              status: SpotlightStatus.ACTIVE,
              scheduleDate: { $lt: now },
              isDeleted: false,
            },
            {
              $set: {
                status: SpotlightStatus.INACTIVE,
              },
            }
          );

          if (result.modifiedCount > 0) {
            console.log(
              `✅ Spotlight Deactivation: ${result.modifiedCount} records set to inactive.`
            );
          }
        } catch (error: any) {
          console.error(
            `❌ Spotlight Deactivation Cron Failed: ${error.message}`
          );
        }
      });
    });

    // ✅ Graceful Shutdown Handlers
    const closeServer = async () => {
      console.log("Shutting down server...");
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
