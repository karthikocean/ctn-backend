import { AppDataSource } from "../data-source";
import { BusinessRegion } from "../entity/BusinessRegion";
import { State } from "../entity/State";
import { City } from "../entity/City";
import { ObjectId } from "mongodb";

export async function migrateRegions() {
  console.log("🏃 Running BusinessRegion migration script...");
  try {
    const regionRepo = AppDataSource.getMongoRepository(BusinessRegion);
    const stateRepo = AppDataSource.getMongoRepository(State);
    const cityRepo = AppDataSource.getMongoRepository(City);

    // Fetch all business regions
    const regions = await regionRepo.find();
    console.log(`🔍 Found ${regions.length} business regions in database.`);

    let migratedCount = 0;

    for (const region of regions) {
      let isUpdated = false;

      // Check state
      let stateId: any = region.state;
      const rawState: any = region.state;
      if (typeof rawState === "string" && !ObjectId.isValid(rawState)) {
        const stateName = rawState.trim();
        const country = region.country ? (region.country as any).trim() : "India";

        let state = await stateRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${stateName}$`, "i") },
            country: { $regex: new RegExp(`^${country}$`, "i") },
            isDeleted: false
          }
        });

        if (!state) {
          state = new State();
          state.name = stateName;
          state.country = country;
          state.isDeleted = false;
          state = await stateRepo.save(state);
          console.log(`✅ Created State: ${stateName}`);
        }

        stateId = state._id;
        isUpdated = true;
      } else if (typeof rawState === "string" && ObjectId.isValid(rawState)) {
        stateId = new ObjectId(rawState);
        isUpdated = true; // Needs type conversion to ObjectId
      }

      // Check city
      let cityId: any = region.city;
      const rawCity: any = region.city;
      if (typeof rawCity === "string" && !ObjectId.isValid(rawCity)) {
        const cityName = rawCity.trim();

        let city = await cityRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${cityName}$`, "i") },
            stateId: stateId,
            isDeleted: false
          }
        });

        if (!city) {
          city = new City();
          city.name = cityName;
          city.stateId = stateId;
          city.isDeleted = false;
          city = await cityRepo.save(city);
          console.log(`✅ Created City: ${cityName}`);
        }

        cityId = city._id;
        isUpdated = true;
      } else if (typeof rawCity === "string" && ObjectId.isValid(rawCity)) {
        cityId = new ObjectId(rawCity);
        isUpdated = true; // Needs type conversion to ObjectId
      }

      // If we made updates, save the region
      if (isUpdated) {
        region.state = stateId;
        region.city = cityId;
        await regionRepo.save(region);
        migratedCount++;
      }
    }

    if (migratedCount > 0) {
      console.log(`🎉 Successfully migrated ${migratedCount} business regions.`);
    } else {
      console.log("⏭️  No business regions needed migration.");
    }
  } catch (error: any) {
    console.error("❌ BusinessRegion migration failed:", error.message);
  }
}
