import rateLimit from "express-rate-limit";

const createRateLimiter = (windowMs: number, max: number, message: string) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message
      });
    }
  });
};

/**
 * General API Limiter
 * Window: 15 minutes | Max: 1000 requests
 */
export const apiLimiter = createRateLimiter(
  15 * 60 * 1000,
  1000,
  "Too many requests. Please try again later."
);

/**
 * Auth API Limiter (Login, Register)
 * Window: 15 minutes | Max: 20 requests
 */
export const authLimiter = createRateLimiter(
  15 * 60 * 1000,
  20,
  "Too many authentication attempts. Please try again later."
);

/**
 * OTP Limiter (Send / Verify OTP)
 * Window: 15 minutes | Max: 10 requests
 */
export const otpLimiter = createRateLimiter(
  15 * 60 * 1000,
  10,
  "Too many OTP requests. Please try again later."
);

/**
 * Password / PIN Reset Limiter
 * Window: 15 minutes | Max: 5 requests
 */
export const passwordResetLimiter = createRateLimiter(
  15 * 60 * 1000,
  5,
  "Too many password/PIN reset attempts. Please try again later."
);

/**
 * File Upload / Excel Import Limiter
 * Window: 15 minutes | Max: 20 requests
 */
export const uploadLimiter = createRateLimiter(
  15 * 60 * 1000,
  20,
  "Too many file upload requests. Please try again later."
);
