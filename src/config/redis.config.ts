import { appRedis, appRedisConfig } from "./appRedis";
import { bullRedisConfig } from "./bullmq.config";

// 100% Backward-compatible re-exports
export { appRedis, appRedisConfig };
export { bullRedisConfig };

export const redisConfig = bullRedisConfig;
export const redisConnection = appRedis;
