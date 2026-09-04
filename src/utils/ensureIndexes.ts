import { DataSource } from "typeorm";

/**
 * Production-safe MongoDB index management.
 *
 * Iterates through all TypeORM entity metadata and safely ensures that all defined
 * `@Index` decorators are registered in MongoDB using the native driver's idempotent
 * `collection.createIndex()` API.
 *
 * Guarantees:
 *  - Safe for production: never drops collections, never drops existing indexes, never touches documents.
 *  - Idempotent: MongoDB no-ops if an identical index already exists.
 *  - Non-blocking: failures on individual non-critical indexes log a warning rather than crashing startup.
 *
 * @param dataSource Initialized TypeORM DataSource
 * @returns Summary of indexed collections and count of ensured indexes
 */
export async function ensureMongoIndexes(dataSource: DataSource): Promise<{
  totalEntities: number;
  totalIndexes: number;
  errors: string[];
}> {
  if (!dataSource.isInitialized) {
    throw new Error("Cannot ensure MongoDB indexes: DataSource is not initialized.");
  }

  let totalIndexes = 0;
  const errors: string[] = [];
  const entityMetadatas = dataSource.entityMetadatas;

  for (const metadata of entityMetadatas) {
    try {
      const repository = dataSource.getMongoRepository(metadata.target);

      // Collect all indexes defined on this entity
      const indexMetadatas = metadata.indices || [];
      if (indexMetadatas.length === 0) {
        continue;
      }

      for (const indexMeta of indexMetadatas) {
        try {
          const indexSpec: Record<string, 1 | -1 | "text" | "2dsphere"> = {};

          // Extract column / field names for the index
          if (indexMeta.givenColumnNames && Array.isArray(indexMeta.givenColumnNames) && indexMeta.givenColumnNames.length > 0) {
            for (const colName of indexMeta.givenColumnNames) {
              if (typeof colName === "string" && colName.trim()) {
                indexSpec[colName.trim()] = 1;
              }
            }
          } else if (indexMeta.columns && indexMeta.columns.length > 0) {
            for (const col of indexMeta.columns) {
              const fieldName = col.databaseName || col.propertyName;
              if (fieldName) {
                indexSpec[fieldName] = 1;
              }
            }
          }

          // Skip if no valid fields were resolved
          if (Object.keys(indexSpec).length === 0) {
            continue;
          }

          // Construct index options
          const options: any = {
            background: true,
          };

          if (indexMeta.isUnique) {
            options.unique = true;
          }
          if (indexMeta.isSparse) {
            options.sparse = true;
          }
          if (indexMeta.name) {
            options.name = indexMeta.name;
          }
          if (indexMeta.expireAfterSeconds !== undefined) {
            options.expireAfterSeconds = indexMeta.expireAfterSeconds;
          }

          await repository.createCollectionIndex(indexSpec, options);
          totalIndexes++;
        } catch (indexErr: any) {
          // If the index already exists with a different name/options, log as warning but do not crash
          const errMsg = `[IndexWarning] Collection "${metadata.tableName}": ${indexErr.message}`;
          console.warn(`⚠️ ${errMsg}`);
          errors.push(errMsg);
        }
      }
    } catch (entityErr: any) {
      const errMsg = `[EntityIndexError] Entity "${metadata.name}": ${entityErr.message}`;
      console.error(`❌ ${errMsg}`);
      errors.push(errMsg);
    }
  }

  // Explicit nested document-level index for BusinessRegion areas (not expressible in TypeORM column decorator)
  try {
    const brRepo = dataSource.getMongoRepository("business_regions");
    await brRepo.createCollectionIndex({ "areas._id": 1 }, { background: true });
    totalIndexes++;
  } catch (err: any) {
    const msg = `[NestedIndexWarning] Collection "business_regions": ${err.message}`;
    console.warn(`⚠️ ${msg}`);
    errors.push(msg);
  }

  return {
    totalEntities: entityMetadatas.length,
    totalIndexes,
    errors,
  };
}
