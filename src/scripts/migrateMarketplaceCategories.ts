import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function runMigration() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("❌ Error: MONGO_URI environment variable is not defined in the environment or .env file.");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    // Connect to database
    await client.connect();
    console.log("🔌 Connected to database successfully.");
    const db = client.db();

    const categoriesCol = db.collection("categories");
    const marketplaceCol = db.collection("marketplace_categories");

    // Fetch all main categories that are active and not deleted
    const mainCategories = await categoriesCol.find({
      type: "MAIN",
      isDeleted: false
    }).toArray();

    console.log(`🔍 Found ${mainCategories.length} active categories of type 'MAIN'.`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const mainCat of mainCategories) {
      const name = mainCat.name;
      if (!name) continue;

      // Case-insensitive search for existing marketplace category with same name
      const existing = await marketplaceCol.findOne({
        name: { $regex: new RegExp(`^${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
        isDeleted: false
      });

      if (!existing) {
        await marketplaceCol.insertOne({
          name: name,
          status: "active",
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        console.log(`✅ Migrated main category: "${name}"`);
        migratedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log("\n🏁 Migration Summary:");
    console.log(`------------------------------`);
    console.log(`📂 Total MAIN scanned: ${mainCategories.length}`);
    console.log(`✨ Newly Migrated:     ${migratedCount}`);
    console.log(`⏩ Skipped (Exists):   ${skippedCount}`);
    console.log(`------------------------------`);

  } catch (error) {
    console.error("❌ Fatal error during marketplace category migration:", error);
  } finally {
    await client.close();
    console.log("🔌 Database connection closed.");
  }
}

runMigration();
