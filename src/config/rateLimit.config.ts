import dotenv from "dotenv";

dotenv.config();

export const rateLimitConfig = {
  enabled: process.env.RATE_LIMIT_ENABLED !== "false",
  redisPrefix: process.env.RATE_LIMIT_REDIS_PREFIX || "rl:",
  
  // 1. General API Throttling
  general: {
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    max: Number(process.env.API_RATE_LIMIT_MAX) || 300 // 300 requests / minute
  },

  // 2. Mobile Authenticated API
  mobile: {
    windowMs: Number(process.env.MOBILE_RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    max: Number(process.env.MOBILE_RATE_LIMIT_MAX) || 300 // 300 requests / minute per user
  },

  // 3. Admin Authenticated API
  admin: {
    windowMs: Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    max: Number(process.env.ADMIN_RATE_LIMIT_MAX) || 600 // 600 requests / minute per admin
  },

  // 4. Authentication (Login)
  auth: {
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10 // 10 attempts / 15 mins
  },

  // 5. OTP (Send / Verify)
  otp: {
    windowMs: Number(process.env.OTP_RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000, // 10 minutes
    max: Number(process.env.OTP_RATE_LIMIT_MAX) || 5 // 5 requests / 10 mins
  },

  // 6. Password / PIN Reset
  passwordReset: {
    windowMs: Number(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.PASSWORD_RESET_RATE_LIMIT_MAX) || 5 // 5 attempts / 15 mins
  },

  // 7. File Upload / Import
  upload: {
    windowMs: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 20 // 20 uploads / 15 mins
  },

  // 8. Search / Expensive Filters
  search: {
    windowMs: Number(process.env.SEARCH_RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    max: Number(process.env.SEARCH_RATE_LIMIT_MAX) || 60 // 60 searches / minute
  },

  // 9. Payment / Order Operations
  payment: {
    windowMs: Number(process.env.PAYMENT_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.PAYMENT_RATE_LIMIT_MAX) || 15 // 15 attempts / 15 mins
  }
};
