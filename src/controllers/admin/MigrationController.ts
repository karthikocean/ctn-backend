import {
  JsonController,
  Post,
  UseBefore,
  Req,
  Res,
  BadRequestError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { BusinessRegion, BusinessRegionStatus } from "../../entity/BusinessRegion";
import { State } from "../../entity/State";
import { City } from "../../entity/City";
import { Category, CategoryType, CategoryStatus } from "../../entity/Category";
import { MarketplaceCategory, MarketplaceCategoryStatus } from "../../entity/MarketplaceCategory";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { parseExcelBufferToJson } from "../../utils/excelHelper";

@JsonController("/migrations")
@UseBefore(AuthMiddleware)
export class MigrationController {
  private stateRepo = AppDataSource.getMongoRepository(State);
  private cityRepo = AppDataSource.getMongoRepository(City);
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private marketplaceCategoryRepo = AppDataSource.getMongoRepository(MarketplaceCategory);

  /**
   * @swagger
   * /api/admin/migrations/regions:
   *   post:
   *     summary: Migrate states, cities, and business regions/areas from Excel
   *     tags: [Migration]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: Regions migrated successfully
   */
  @Post("/regions")
  @UseBefore(canAccess("business_regions", "add"))
  async migrateRegions(@Req() req: any, @Res() res: any) {
    try {
      if (!req.files || !req.files.file) {
        throw new BadRequestError("No file uploaded. Please upload a file with the key 'file'.");
      }

      const file = req.files.file;
      const jsonData = await parseExcelBufferToJson<any>(file.data);

      let statesCreated = 0;
      let citiesCreated = 0;
      let regionsCreated = 0;
      let regionsUpdated = 0;
      let areasAdded = 0;
      let skippedCount = 0;

      let lastStateName = "";
      const country = "India";

      for (const row of jsonData) {
        let stateName = "";
        let cityName = "";
        let regionName = ""; // Represents Selected Region/Area

        for (const key of Object.keys(row)) {
          const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "");
          if (normalizedKey === "state") {
            stateName = String(row[key] || "").trim();
          } else if (normalizedKey === "city") {
            cityName = String(row[key] || "").trim();
          } else if (
            normalizedKey === "selectedregion" ||
            normalizedKey === "selectedrigion" ||
            normalizedKey === "region" ||
            normalizedKey === "rigion"
          ) {
            regionName = String(row[key] || "").trim();
          }
        }

        // Handle empty state cells for rows grouped under a state
        if (!stateName) {
          stateName = lastStateName;
        } else {
          lastStateName = stateName;
        }

        // If no state or city, skip this row
        if (!stateName || !cityName) {
          skippedCount++;
          continue;
        }

        // 1. Find or create State (case-insensitive)
        let state = await this.stateRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${stateName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
            country: { $regex: new RegExp(`^${country}$`, "i") },
            isDeleted: false
          }
        });

        if (!state) {
          state = new State();
          state.name = stateName;
          state.country = country;
          state.isDeleted = false;
          state = await this.stateRepo.save(state);
          statesCreated++;
        }

        // 2. Find or create City (case-insensitive under this state)
        let city = await this.cityRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${cityName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
            stateId: state._id,
            isDeleted: false
          }
        });

        if (!city) {
          city = new City();
          city.name = cityName;
          city.stateId = state._id;
          city.isDeleted = false;
          city = await this.cityRepo.save(city);
          citiesCreated++;
        }

        // 3. Find or create BusinessRegion for (country, state, city)
        let region = await this.regionRepo.findOne({
          where: {
            country: country,
            state: state._id,
            city: city._id,
            isDeleted: false
          }
        });

        let regionWasCreated = false;
        if (!region) {
          region = new BusinessRegion();
          region.country = country;
          region.state = state._id;
          region.city = city._id;
          region.status = BusinessRegionStatus.ACTIVE;
          region.areas = [];
          region.isDeleted = false;
          regionsCreated++;
          regionWasCreated = true;
        }

        // 4. Handle Area (Selected Region)
        if (regionName) {
          const areaExists = (region.areas || []).some(
            (a) => a.name.trim().toLowerCase() === regionName.toLowerCase()
          );

          if (!areaExists) {
            if (!region.areas) {
              region.areas = [];
            }
            region.areas.push({
              _id: new ObjectId(),
              name: regionName
            });
            areasAdded++;
            if (!regionWasCreated) {
              regionsUpdated++;
            }
          }
        }

        await this.regionRepo.save(region);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Regions migrated successfully.",
        data: {
          statesCreated,
          citiesCreated,
          regionsCreated,
          regionsUpdated,
          areasAdded,
          skipped: skippedCount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/migrations/categories:
   *   post:
   *     summary: Migrate main categories and sub categories from Excel
   *     tags: [Migration]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: Categories migrated successfully
   */
  @Post("/categories")
  @UseBefore(canAccess("categories", "add"))
  async migrateCategories(@Req() req: any, @Res() res: any) {
    try {
      if (!req.files || !req.files.file) {
        throw new BadRequestError("No file uploaded. Please upload a file with the key 'file'.");
      }

      const file = req.files.file;
      const jsonData = await parseExcelBufferToJson<any>(file.data);

      let mainCategoriesCreated = 0;
      let subCategoriesCreated = 0;
      let skippedCount = 0;

      let lastMainCategoryName = "";

      for (const row of jsonData) {
        let rawMainCategory = "";
        let subCategoryName = "";

        for (const key of Object.keys(row)) {
          const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "");
          if (normalizedKey === "maincategory") {
            rawMainCategory = String(row[key] || "").trim();
          } else if (
            normalizedKey === "subcategories" ||
            normalizedKey === "subcategory"
          ) {
            subCategoryName = String(row[key] || "").trim();
          }
        }

        // If the row is completely blank (both main and sub category are empty), skip it
        if (!rawMainCategory && !subCategoryName) {
          continue;
        }

        let mainCategoryName = rawMainCategory;
        if (!mainCategoryName) {
          mainCategoryName = lastMainCategoryName;
        } else {
          lastMainCategoryName = mainCategoryName;
        }

        if (!mainCategoryName) {
          skippedCount++;
          continue;
        }

        // 1. Find or create Main Category (case-insensitive)
        let mainCategory = await this.categoryRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${mainCategoryName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
            type: CategoryType.MAIN,
            isDeleted: false
          }
        });

        if (!mainCategory) {
          try {
            mainCategory = new Category();
            mainCategory.name = mainCategoryName;
            mainCategory.type = CategoryType.MAIN;
            mainCategory.status = CategoryStatus.ACTIVE;
            mainCategory.isDeleted = false;
            mainCategory = await this.categoryRepo.save(mainCategory);
            mainCategoriesCreated++;
          } catch (err: any) {
            if (err.code === 11000 || (err.message && err.message.includes("already exists"))) {
              // Retrieve the existing category if created concurrently
              mainCategory = await this.categoryRepo.findOne({
                where: {
                  name: { $regex: new RegExp(`^${mainCategoryName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
                  type: CategoryType.MAIN,
                  isDeleted: false
                }
              });
              if (!mainCategory) {
                skippedCount++;
                continue;
              }
            } else {
              console.error(`Error saving main category ${mainCategoryName}:`, err);
              skippedCount++;
              continue;
            }
          }
        }

        // 2. Find or create Sub Category (case-insensitive, unique check by name and type)
        if (subCategoryName) {
          let subCategory = await this.categoryRepo.findOne({
            where: {
              name: { $regex: new RegExp(`^${subCategoryName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
              type: CategoryType.SUB,
              isDeleted: false
            }
          });

          if (!subCategory) {
            try {
              subCategory = new Category();
              subCategory.name = subCategoryName;
              subCategory.type = CategoryType.SUB;
              subCategory.parentCategory = mainCategory._id;
              subCategory.status = CategoryStatus.ACTIVE;
              subCategory.isDeleted = false;
              await this.categoryRepo.save(subCategory);
              subCategoriesCreated++;
            } catch (err: any) {
              if (err.code === 11000 || (err.message && err.message.includes("already exists"))) {
                console.log(`Skipped existing subcategory (duplicate key): ${subCategoryName}`);
              } else {
                console.error(`Error saving sub category ${subCategoryName}:`, err);
              }
            }
          }
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Categories migrated successfully.",
        data: {
          mainCategoriesCreated,
          subCategoriesCreated,
          skipped: skippedCount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/migrations/sync-marketplace:
   *   post:
   *     summary: Sync main categories to marketplace categories
   *     tags: [Migration]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Categories synced successfully
   */
  @Post("/sync-marketplace")
  @UseBefore(canAccess("categories", "add"))
  async syncMarketplaceCategories(@Req() req: any, @Res() res: any) {
    try {
      const mainCategories = await this.categoryRepo.find({
        where: {
          type: CategoryType.MAIN,
          isDeleted: false
        }
      });

      let migratedCount = 0;
      let skippedCount = 0;

      for (const cat of mainCategories) {
        if (!cat.name) continue;

        const existing = await this.marketplaceCategoryRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${cat.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
            isDeleted: false
          }
        });

        if (!existing) {
          const marketplaceCat = new MarketplaceCategory();
          marketplaceCat.name = cat.name;
          marketplaceCat.status = MarketplaceCategoryStatus.ACTIVE;
          marketplaceCat.isDeleted = false;
          await this.marketplaceCategoryRepo.save(marketplaceCat);
          migratedCount++;
        } else {
          skippedCount++;
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Marketplace categories synced successfully.",
        data: {
          scanned: mainCategories.length,
          migrated: migratedCount,
          skipped: skippedCount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
