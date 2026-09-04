import { DataSource } from "typeorm";
import dotenv from "dotenv";

dotenv.config();

const ext = __filename.endsWith(".ts") ? "ts" : "js";
const isProduction = process.env.NODE_ENV === "production";

export const AppDataSource = new DataSource({
  type: "mongodb",
  url: process.env.MONGO_URI || "",
  // Production MUST NOT use automatic schema synchronization.
  // In development, synchronize defaults to true unless explicitly overridden via TYPEORM_SYNCHRONIZE.
  synchronize: process.env.TYPEORM_SYNCHRONIZE !== undefined
    ? process.env.TYPEORM_SYNCHRONIZE === "true"
    : !isProduction,
  logging: !isProduction,
  entities: [`${__dirname}/entity/**/*.${ext}`],
  extra: {
    maxPoolSize: process.env.MONGO_MAX_POOL_SIZE ? parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) : 100,
    minPoolSize: process.env.MONGO_MIN_POOL_SIZE ? parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) : 5,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000
  }
});
