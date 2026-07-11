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
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import * as XLSX from "xlsx";

@JsonController("/migrations")
@UseBefore(AuthMiddleware)
export class MigrationController {
  private stateRepo = AppDataSource.getMongoRepository(State);
  private cityRepo = AppDataSource.getMongoRepository(City);
  private regionRepo = AppDataSource.getMongoRepository(BusinessRegion);

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
      const workbook = XLSX.read(file.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(sheet);

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
}
