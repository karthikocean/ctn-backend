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

// Safety Requirements:
// 1. The script must NEVER execute automatically.
// 4. If the script is imported anywhere else in the project, it must not execute.
// 5. The cleanup should only start when the file is executed directly.
if (require.main === module) {
  // 3. Additionally, require an environment variable: CONFIRM_DELETE_DATABASE=true
  // If this variable is missing or not equal to "true", immediately exit.
  if (process.env.CONFIRM_DELETE_DATABASE !== "true") {
    console.error("❌ Database cleanup aborted.");
    console.error("Set CONFIRM_DELETE_DATABASE=true to continue.");
    process.exit(1);
  }

  runCleanup().catch((err) => {
    console.error("Fatal error executing cleanup script:", err);
    process.exit(1);
  });
}
