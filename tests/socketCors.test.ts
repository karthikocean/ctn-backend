/**
 * Tests for Socket.io CORS origin validation (P2-2)
 */

import { getSocketCorsOrigin } from "../src/utils/socket";

describe("Socket.io CORS Origin Validation (P2-2)", () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test("1. Allows native mobile applications and non-browser clients (origin is undefined)", (done) => {
    const corsValidator = getSocketCorsOrigin();
    corsValidator(undefined, (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  test("2. Allows configured localhost development origins in development mode", (done) => {
    process.env.NODE_ENV = "development";
    const corsValidator = getSocketCorsOrigin();

    corsValidator("http://localhost:3000", (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  test("3. Allows custom origins specified via SOCKET_ALLOWED_ORIGINS", (done) => {
    process.env.SOCKET_ALLOWED_ORIGINS = "https://custom-portal.trustednetwork.in,https://app.custom.com";
    const corsValidator = getSocketCorsOrigin();

    corsValidator("https://custom-portal.trustednetwork.in", (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);

      corsValidator("https://app.custom.com", (err2, allow2) => {
        expect(err2).toBeNull();
        expect(allow2).toBe(true);
        done();
      });
    });
  });

  test("4. Rejects disallowed origins with CORS error", (done) => {
    process.env.NODE_ENV = "production";
    process.env.SOCKET_ALLOWED_ORIGINS = "https://admin.trustednetwork.in";
    const corsValidator = getSocketCorsOrigin();

    corsValidator("https://attacker-site.com", (err, allow) => {
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toContain("not allowed by Socket.io CORS policy");
      expect(allow).toBe(false);
      done();
    });
  });

  test("5. Rejects unknown origin in development mode", (done) => {
    process.env.NODE_ENV = "development";
    delete process.env.SOCKET_ALLOWED_ORIGINS;
    const corsValidator = getSocketCorsOrigin();

    corsValidator("https://evil-hacker.com", (err, allow) => {
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toContain("not allowed by Socket.io CORS policy");
      expect(allow).toBe(false);
      done();
    });
  });
});
