/**
 * Tests for SMS Security & Credential Redaction (P2-6)
 */

import axios from "axios";
import {
  sendOTPSMS,
  sendForgotPinSMS,
  sanitizeSmsLogMessage,
  getSafeSmsErrorMessage
} from "../src/utils/sms";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SMS Security & Credential Protection (P2-6)", () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...origEnv };
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test("1. sanitizeSmsLogMessage replaces API key with [REDACTED_API_KEY]", () => {
    const rawLog = "Failed to connect using secret_sms_api_key_12345 on gateway";
    const sanitized = sanitizeSmsLogMessage(rawLog, "secret_sms_api_key_12345");

    expect(sanitized).toBe("Failed to connect using [REDACTED_API_KEY] on gateway");
    expect(sanitized).not.toContain("secret_sms_api_key_12345");
  });

  test("2. getSafeSmsErrorMessage strips API key from nested error messages", () => {
    const mockError = {
      message: "Request failed with status code 401 with key super_secret_key_abc",
      response: {
        data: {
          message: "Invalid apikey super_secret_key_abc provided"
        }
      }
    };

    const safeMessage = getSafeSmsErrorMessage(mockError, "super_secret_key_abc");
    expect(safeMessage).toBe("Invalid apikey [REDACTED_API_KEY] provided");
    expect(safeMessage).not.toContain("super_secret_key_abc");
  });

  test("3. sendOTPSMS returns null safely when configuration is missing", async () => {
    delete process.env.SMS_API_KEY;
    delete process.env.SMS_SENDER_ID;
    delete process.env.SMS_WELCOME_TEMPLATE_ID;

    const result = await sendOTPSMS("9876543210", "123456");
    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test("4. sendOTPSMS makes request and handles errors without leaking credentials", async () => {
    process.env.SMS_API_KEY = "test_key_xyz";
    process.env.SMS_SENDER_ID = "NALSUV";
    process.env.SMS_WELCOME_TEMPLATE_ID = "TMPL001";

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Mock axios failure with sensitive config
    mockedAxios.post.mockRejectedValueOnce({
      message: "Gateway Timeout (key: test_key_xyz)",
      config: {
        params: {
          apikey: "test_key_xyz"
        }
      }
    });

    const result = await sendOTPSMS("9876543210", "654321");
    expect(result).toBeNull();

    // Verify console.error does not log the raw key
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedError = consoleErrorSpy.mock.calls[0][0];
    expect(loggedError).not.toContain("test_key_xyz");
    expect(loggedError).toContain("[REDACTED_API_KEY]");

    consoleErrorSpy.mockRestore();
  });

  test("5. sendForgotPinSMS succeeds with valid response data", async () => {
    process.env.SMS_API_KEY = "test_key_xyz";
    process.env.SMS_SENDER_ID = "NALSUV";
    process.env.SMS_FORGOT_PIN_TEMPLATE_ID = "TMPL002";

    mockedAxios.post.mockResolvedValueOnce({
      data: { status: "success", msgid: "12345678" }
    });

    const result = await sendForgotPinSMS("9876543210", "998877");
    expect(result).toEqual({ status: "success", msgid: "12345678" });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      {},
      expect.objectContaining({
        params: expect.objectContaining({
          apikey: "test_key_xyz",
          senderid: "NALSUV",
          templateid: "TMPL002",
          number: "9876543210"
        })
      })
    );
  });
});
