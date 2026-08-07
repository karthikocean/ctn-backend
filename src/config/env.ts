import dotenv from "dotenv";

dotenv.config();

export function validateEnv(): void {
  const required = ["JWT_SECRET"];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️ Warning: Missing environment variables: ${missing.join(", ")}. Fallbacks will be used where applicable.`);
  }
}
