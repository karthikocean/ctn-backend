import dotenv from "dotenv";

dotenv.config();

export function validateEnv(): void {
  const required = ["JWT_SECRET"];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️ Warning: Missing environment variables: ${missing.join(", ")}. Fallbacks will be used where applicable.`);
  }
}

/**
 * Checks whether cron notifications are enabled.
 * If NOTIFICATION (or Notification) is set to 'false' in env,
 * cron notifications will NOT be sent.
 * Defaults to true if not specified.
 */
export function isCronNotificationEnabled(): boolean {
  let rawValue = process.env.NOTIFICATION ?? process.env.Notification ?? process.env.CRON_NOTIFICATION;
  if (rawValue === undefined) {
    for (const [key, val] of Object.entries(process.env)) {
      const cleanKey = key.trim().toUpperCase();
      if (cleanKey === "NOTIFICATION" || cleanKey === "CRON_NOTIFICATION") {
        rawValue = val;
        break;
      }
    }
  }
  if (rawValue !== undefined && rawValue !== null) {
    const normalized = String(rawValue).trim().toLowerCase();
    if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
      return false;
    }
  }
  return true;
}

