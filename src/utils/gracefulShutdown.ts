import { Server as HttpServer } from "http";
import { AppDataSource } from "../data-source";
import { getIO, waitForDisconnects } from "./socket";
import { personalWorker } from "../workers/personal.worker";
import { broadcastWorker } from "../workers/broadcast.worker";
import { dlqWorker } from "../workers/dlq.worker";
import {
  personalNotificationQueue,
  broadcastNotificationQueue,
  dlqNotificationQueue,
} from "../queues/notification.queue";
import { appRedis } from "../config/appRedis";

let isShuttingDown = false;
let httpServerRef: HttpServer | null = null;

/**
 * Stores a reference to the active HTTP server for graceful connection closing.
 */
export function setHttpServer(server: HttpServer): void {
  httpServerRef = server;
}

/**
 * Centralized, idempotent graceful shutdown handler.
 * Safely terminates HTTP server, WebSocket connections, BullMQ workers/queues,
 * Redis connections, and the TypeORM database connection in an orderly manner.
 *
 * @param signal The received OS termination signal (SIGINT, SIGTERM, SIGUSR2)
 */
export async function gracefulShutdown(signal: string = "SIGTERM"): Promise<void> {
  if (isShuttingDown) {
    console.log(`⚠️ [Graceful Shutdown] Shutdown already in progress. Ignoring additional signal: ${signal}`);
    return;
  }

  isShuttingDown = true;
  console.log(`\n🛑 [Graceful Shutdown] ${signal} received. Initiating orderly shutdown...`);

  // Force-exit timeout safeguard (10 seconds) to prevent hanging the process indefinitely
  const forceExitTimeout = setTimeout(() => {
    console.error("❌ [Graceful Shutdown] Forced exit: Shutdown exceeded timeout limit (10s).");
    process.exit(1);
  }, 10000);

  // Unref timeout so it doesn't keep the event loop alive if everything closes earlier
  forceExitTimeout.unref();

  let hasError = false;

  // 1. Close WebSocket / Socket.io server
  try {
    const io = getIO();
    if (io) {
      console.log("🔌 [Graceful Shutdown] Disconnecting Socket.io clients...");
      io.close();
      await waitForDisconnects(2000);
      console.log("✅ [Graceful Shutdown] Socket.io server closed.");
    }
  } catch (err: any) {
    console.log("ℹ️ [Graceful Shutdown] Socket.io was not active or already closed.");
  }

  // 2. Stop accepting new HTTP requests and close active HTTP server
  if (httpServerRef) {
    try {
      console.log("🌐 [Graceful Shutdown] Closing HTTP server...");
      await new Promise<void>((resolve, reject) => {
        httpServerRef!.close((err) => {
          if (err) {
            console.error("❌ [Graceful Shutdown] Error closing HTTP server:", err.message);
            return reject(err);
          }
          console.log("✅ [Graceful Shutdown] HTTP server closed.");
          resolve();
        });
      });
    } catch (err) {
      hasError = true;
    }
  }

  // 3. Close BullMQ workers (waits for in-progress jobs to finish)
  try {
    console.log("⏳ [Graceful Shutdown] Pausing and closing BullMQ workers...");
    await Promise.allSettled([
      personalWorker.close(),
      broadcastWorker.close(),
      dlqWorker.close(),
    ]);
    console.log("✅ [Graceful Shutdown] All BullMQ workers closed cleanly.");
  } catch (err: any) {
    console.error("❌ [Graceful Shutdown] Error closing workers:", err.message);
    hasError = true;
  }

  // 4. Close BullMQ Queues
  try {
    console.log("⏳ [Graceful Shutdown] Closing BullMQ queues...");
    await Promise.allSettled([
      personalNotificationQueue.close(),
      broadcastNotificationQueue.close(),
      dlqNotificationQueue.close(),
    ]);
    console.log("✅ [Graceful Shutdown] All BullMQ queues closed.");
  } catch (err: any) {
    console.error("❌ [Graceful Shutdown] Error closing queues:", err.message);
    hasError = true;
  }

  // 5. Disconnect Redis connection
  try {
    console.log("⏳ [Graceful Shutdown] Closing Redis connection...");
    if (appRedis.status === "ready" || appRedis.status === "connecting") {
      await appRedis.quit();
    }
    console.log("✅ [Graceful Shutdown] Redis connection closed.");
  } catch (err: any) {
    console.error("❌ [Graceful Shutdown] Error closing Redis:", err.message);
  }

  // 6. Close MongoDB / TypeORM connection
  try {
    if (AppDataSource.isInitialized) {
      console.log("⏳ [Graceful Shutdown] Closing MongoDB database connection...");
      await AppDataSource.destroy();
      console.log("✅ [Graceful Shutdown] Database connection closed.");
    }
  } catch (err: any) {
    console.error("❌ [Graceful Shutdown] Error closing database:", err.message);
    hasError = true;
  }

  console.log("🏁 [Graceful Shutdown] Shutdown complete. Exiting process.");
  process.exit(hasError ? 1 : 0);
}

/**
 * Registers one-time signal listeners for graceful shutdown.
 * Guarantees that each signal (SIGINT, SIGTERM, SIGUSR2) is registered only once.
 */
export function registerGracefulShutdown(server?: HttpServer): void {
  if (server) {
    setHttpServer(server);
  }

  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGUSR2", () => gracefulShutdown("SIGUSR2")); // For nodemon restarts
}
