import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { AppDataSource } from "../data-source";
import { ensureMongoIndexes } from "../utils/ensureIndexes";

async function run() {
  console.log("🔄 Initializing database connection to check/ensure MongoDB indexes...");
  await AppDataSource.initialize();
  console.log("✅ Database connected successfully.");

  console.log("🔄 Ensuring MongoDB indexes across all registered entities...");
  const result = await ensureMongoIndexes(AppDataSource);

  console.log("==========================================");
  console.log("📊 MongoDB Index Verification Complete");
  console.log(`Entities Inspected : ${result.totalEntities}`);
  console.log(`Indexes Ensured    : ${result.totalIndexes}`);
  if (result.errors.length > 0) {
    console.log(`Warnings/Errors    : ${result.errors.length}`);
    result.errors.forEach((err) => console.log(`  - ${err}`));
  }
  console.log("==========================================");

  await AppDataSource.destroy();
  console.log("✅ Database connection closed.");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Fatal error ensuring indexes:", err);
  process.exit(1);
});
