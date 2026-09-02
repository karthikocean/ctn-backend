/**
 * Tests for the Store-Test OTP configuration module.
 * Run with: npx jest --testPathPattern=storeTestOtp
 */

import { isStoreTestOtpValid, isStoreTestMobileNumber } from "../src/config/storeTest.config";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const originals: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    originals[key] = process.env[key];
    if (value === undefined) { delete process.env[key]; }
    else { process.env[key] = value; }
  }
  try { fn(); }
  finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) { delete process.env[key]; }
      else { process.env[key] = value; }
    }
  }
}

const BASE_ENV = {
  STORE_TEST_OTP_ENABLED: "true",
  STORE_TEST_OTP: "1234",
  STORE_TEST_MOBILE_NUMBERS: "9876543210,9123456789",
};

describe("isStoreTestOtpValid", () => {
  test("TC-1 | configured test number + correct OTP -> true", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(true);
      expect(isStoreTestOtpValid("9123456789", "1234")).toBe(true);
    });
  });

  test("TC-2 | configured test number + wrong OTP -> false", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestOtpValid("9876543210", "0000")).toBe(false);
      expect(isStoreTestOtpValid("9876543210", "")).toBe(false);
      expect(isStoreTestOtpValid("9876543210", "12345")).toBe(false);
    });
  });

  test("TC-3 | normal user + test OTP (1234) -> false", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestOtpValid("9000000000", "1234")).toBe(false);
      expect(isStoreTestOtpValid("", "1234")).toBe(false);
    });
  });

  test("TC-4 | STORE_TEST_OTP_ENABLED=false -> false for configured number", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_OTP_ENABLED: "false" }, () => {
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(false);
    });
  });

  test("TC-5 | STORE_TEST_OTP_ENABLED absent -> false", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_OTP_ENABLED: undefined }, () => {
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(false);
    });
  });

  test("TC-6 | empty STORE_TEST_OTP -> false", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_OTP: "" }, () => {
      expect(isStoreTestOtpValid("9876543210", "")).toBe(false);
    });
  });

  test("TC-7 | empty STORE_TEST_MOBILE_NUMBERS -> false", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_MOBILE_NUMBERS: "" }, () => {
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(false);
    });
  });

  test("TC-8 | absent STORE_TEST_MOBILE_NUMBERS -> false", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_MOBILE_NUMBERS: undefined }, () => {
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(false);
    });
  });

  test("TC-9 | whitespace-padded numbers in env -> still matches", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_MOBILE_NUMBERS: " 9876543210 , 9123456789 " }, () => {
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(true);
    });
  });

  test("TC-9b | trailing comma does not produce empty-string match", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_MOBILE_NUMBERS: "9876543210," }, () => {
      expect(isStoreTestOtpValid("", "1234")).toBe(false);
    });
  });

  test("TC-10 | test number that does not exist in DB (account guard) - config returns true", () => {
    withEnv(BASE_ENV, () => {
      // The config fn only validates the OTP binding; member-existence check
      // is done in the controller before calling this function.
      // If controller fetches no member, it throws before ever reaching this fn.
      // Here we only verify the config layer returns true for a configured number.
      expect(isStoreTestOtpValid("9876543210", "1234")).toBe(true);
    });
  });
});

describe("isStoreTestMobileNumber", () => {
  test("configured number -> true", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestMobileNumber("9876543210")).toBe(true);
    });
  });

  test("non-configured number -> false", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestMobileNumber("9000000000")).toBe(false);
    });
  });

  test("feature disabled -> false even for configured number", () => {
    withEnv({ ...BASE_ENV, STORE_TEST_OTP_ENABLED: "false" }, () => {
      expect(isStoreTestMobileNumber("9876543210")).toBe(false);
    });
  });

  test("empty number -> false", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestMobileNumber("")).toBe(false);
    });
  });
});

describe("Normal OTP flow is NOT short-circuited", () => {
  test("normal user + 1234 (test OTP) -> false", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestOtpValid("9111111111", "1234")).toBe(false);
    });
  });

  test("normal user + their own generated OTP -> config returns false (DB check takes over)", () => {
    withEnv(BASE_ENV, () => {
      expect(isStoreTestOtpValid("9111111111", "7492")).toBe(false);
    });
  });
});
