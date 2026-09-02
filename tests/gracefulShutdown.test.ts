/**
 * Tests for the consolidated, idempotent graceful shutdown handler.
 */

describe("Graceful Shutdown Handler", () => {
  let mockExit: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    mockExit = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    mockConsoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
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
