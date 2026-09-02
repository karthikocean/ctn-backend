/**
 * Tests for TypeORM DataSource synchronization behavior across environments.
 */

import * as dotenv from "dotenv";
dotenv.config();

describe("DataSource Synchronization Configuration", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSync = process.env.TYPEORM_SYNCHRONIZE;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSync === undefined) {
      delete process.env.TYPEORM_SYNCHRONIZE;
    } else {
      process.env.TYPEORM_SYNCHRONIZE = originalSync;
    }
    jest.resetModules();
  });

  test("Production: synchronize is FALSE by default", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TYPEORM_SYNCHRONIZE;

    const { AppDataSource } = require("../src/data-source");
    expect(AppDataSource.options.synchronize).toBe(false);
  });

  test("Development: synchronize is TRUE by default", () => {
    process.env.NODE_ENV = "development";
    delete process.env.TYPEORM_SYNCHRONIZE;

    const { AppDataSource } = require("../src/data-source");
    expect(AppDataSource.options.synchronize).toBe(true);
  });

  test("Explicit override: TYPEORM_SYNCHRONIZE=false forces synchronize to false in development", () => {
    process.env.NODE_ENV = "development";
    process.env.TYPEORM_SYNCHRONIZE = "false";

    const { AppDataSource } = require("../src/data-source");
    expect(AppDataSource.options.synchronize).toBe(false);
  });

  test("Explicit override: TYPEORM_SYNCHRONIZE=true forces synchronize to true in production", () => {
    process.env.NODE_ENV = "production";
    process.env.TYPEORM_SYNCHRONIZE = "true";

    const { AppDataSource } = require("../src/data-source");
    expect(AppDataSource.options.synchronize).toBe(true);
  });
});
