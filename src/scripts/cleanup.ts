import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration: The protected collection list should exist in a single constant array for easy modification.
const PROTECTED_COLLECTIONS: string[] = [
  "roles",
  "permissions",
  "modules",
  "plans",
  "adminusers", // Protect the collection for AdminUser entity
  "countries",
  "states",
  "cities",
  "business_regions",
  "categories",
  "marketplace_categories",
  "point_configs"
];

async function runCleanup() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("❌ Error: MONGO_URI environment variable is not defined in the environment or .env file.");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    // Connect to the MongoDB database
    await client.connect();
    const db = client.db();

    // Fetch all collections in the database
    const collections = await db.listCollections().toArray();

    let deletedCollectionsCount = 0;
    let deletedDocumentsCount = 0;
    let skippedCollectionsCount = 0;

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;

      // Skip system collections
      if (collectionName.startsWith("system.")) {
        continue;
      }

      if (PROTECTED_COLLECTIONS.includes(collectionName)) {
        console.log(`Skipping ${collectionName}`);
        skippedCollectionsCount++;
        continue;
      }

      try {
        const result = await db.collection(collectionName).deleteMany({});
        console.log(`Deleted ${collectionName} (${result.deletedCount})`);
        deletedCollectionsCount++;
        deletedDocumentsCount += result.deletedCount;
      } catch (error) {
        console.error(`❌ Error deleting documents from collection ${collectionName}:`, error);
      }
    }

    // Print final summary
    console.log("==========================");
    console.log("Database Cleanup Complete");
    console.log(`Deleted Collections : ${deletedCollectionsCount}`);
    console.log(`Deleted Documents   : ${deletedDocumentsCount}`);
    console.log(`Skipped Collections : ${skippedCollectionsCount}`);
    console.log("==========================");

  } catch (error) {
    console.error("❌ Fatal database cleanup error:", error);
    process.exit(1);
  } finally {
    // Close the connection
    await client.close();
  }
}

/**
 * Validates whether database cleanup execution is permitted.
 * Unconditionally blocks execution if NODE_ENV is production.
 * Requires explicit CONFIRM_DELETE_DATABASE=true in non-production.
 */
export function validateCleanupExecution(
  nodeEnv: string = process.env.NODE_ENV || "development",
  confirmDelete: string = process.env.CONFIRM_DELETE_DATABASE || ""
): { allowed: boolean; reason?: string } {
  if (nodeEnv === "production") {
    return {
      allowed: false,
      reason: "Database cleanup is strictly forbidden in production (NODE_ENV=production)."
    };
  }

  if (confirmDelete !== "true") {
    return {
      allowed: false,
      reason: "Database cleanup requires explicit confirmation: CONFIRM_DELETE_DATABASE=true."
    };
  }

  return { allowed: true };
}

// Safety Requirements:
// 1. The script must NEVER execute automatically.
// 2. If the script is imported anywhere else in the project, it must not execute.
// 3. The cleanup should only start when the file is executed directly.
if (require.main === module) {
  const validation = validateCleanupExecution(process.env.NODE_ENV, process.env.CONFIRM_DELETE_DATABASE);
  if (!validation.allowed) {
    console.error(`❌ Fatal: ${validation.reason}`);
    process.exit(1);
  }

  runCleanup().catch((err) => {
    console.error("Fatal error executing cleanup script:", err);
    process.exit(1);
  });
}
