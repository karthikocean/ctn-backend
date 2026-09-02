/**
 * Store Test OTP Configuration
 *
 * Provides a controlled, environment-variable-driven mechanism to allow
 * Play Store / App Store reviewers to authenticate using a fixed OTP on
 * dedicated test accounts.
 *
 * Security guarantees:
 *  - The fixed OTP works ONLY for explicitly configured test mobile numbers.
 *  - It NEVER bypasses member existence, status, or account-lockout checks.
 *  - It NEVER bypasses session/token creation or rate limiting.
 *  - Configured numbers and the OTP itself are never exposed through any API.
 */

/**
 * Returns the set of normalised mobile numbers that are allowed to use
 * the store-test OTP.  Numbers are trimmed; an empty set means the feature
 * is effectively disabled even when STORE_TEST_OTP_ENABLED=true.
 */
function getStoreTestMobileNumbers(): Set<string> {
  const raw = process.env.STORE_TEST_MOBILE_NUMBERS || "";
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
  );
}

/**
 * Checks whether the given mobile number is a configured store-test account
 * AND the supplied OTP matches the configured store-test OTP.
 *
 * Returns `true` only when ALL of the following are satisfied:
 *   1. STORE_TEST_OTP_ENABLED === "true"
 *   2. STORE_TEST_OTP is set and non-empty
 *   3. STORE_TEST_MOBILE_NUMBERS contains the supplied mobile number
 *   4. The supplied OTP exactly matches STORE_TEST_OTP
 *
 * @param mobileNumber - The mobile number extracted from the member record
 *                       or from the request body (must already be normalised)
 * @param otp          - The OTP supplied by the client
 */
export function isStoreTestOtpValid(mobileNumber: string, otp: string): boolean {
  if (process.env.STORE_TEST_OTP_ENABLED !== "true") return false;

  const testOtp = (process.env.STORE_TEST_OTP || "").trim();
  if (!testOtp) return false;

  const testNumbers = getStoreTestMobileNumbers();
  if (testNumbers.size === 0) return false;

  const normalised = (mobileNumber || "").trim();
  if (!normalised) return false;

  return testNumbers.has(normalised) && otp === testOtp;
}

/**
 * Returns true if the given mobile number is one of the configured
 * store-test accounts (regardless of which OTP was supplied).
 *
 * Used to decide whether to log a "test-path used" message.
 */
export function isStoreTestMobileNumber(mobileNumber: string): boolean {
  if (process.env.STORE_TEST_OTP_ENABLED !== "true") return false;
  const testNumbers = getStoreTestMobileNumbers();
  return testNumbers.has((mobileNumber || "").trim());
}
