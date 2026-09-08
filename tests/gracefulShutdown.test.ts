/**
 * Tests for the consolidated, idempotent graceful shutdown handler.
 */

jest.mock("../src/workers/personal.worker", () => ({
  personalWorker: { close: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock("../src/workers/broadcast.worker", () => ({
  broadcastWorker: { close: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock("../src/workers/dlq.worker", () => ({
  dlqWorker: { close: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock("../src/queues/notification.queue", () => ({
  personalNotificationQueue: { close: jest.fn().mockResolvedValue(undefined) },
  broadcastNotificationQueue: { close: jest.fn().mockResolvedValue(undefined) },
  dlqNotificationQueue: { close: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock("../src/config/appRedis", () => ({
  appRedis: { quit: jest.fn().mockResolvedValue("OK"), disconnect: jest.fn() }
}));
jest.mock("../src/data-source", () => ({
  AppDataSource: { isInitialized: false, destroy: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock("../src/utils/socket", () => ({
  getIO: jest.fn().mockReturnValue(null),
  waitForDisconnects: jest.fn().mockResolvedValue(undefined)
}));

describe("Graceful Shutdown Handler", () => {
  let mockExit: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    mockExit = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    mockConsoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    mockExit.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test("Registration: registers signals once using process.once", () => {
    const onceSpy = jest.spyOn(process, "once");
    const { registerGracefulShutdown } = require("../src/utils/gracefulShutdown");

    registerGracefulShutdown();

    const registeredSignals = onceSpy.mock.calls.map(call => call[0]);
    expect(registeredSignals).toContain("SIGINT");
    expect(registeredSignals).toContain("SIGTERM");
    expect(registeredSignals).toContain("SIGUSR2");

    onceSpy.mockRestore();
  });

  test("Idempotency: concurrent invocations execute shutdown logic only once", async () => {
    const { gracefulShutdown } = require("../src/utils/gracefulShutdown");

    // Invoke multiple times concurrently
    const p1 = gracefulShutdown("SIGINT");
    const p2 = gracefulShutdown("SIGTERM");
    const p3 = gracefulShutdown("SIGINT");

    await Promise.all([p1, p2, p3]);

    // process.exit should be called exactly once
    expect(mockExit).toHaveBeenCalledTimes(1);
  });
});
