import { AppDataSource } from "../data-source";
import { State } from "../entity/State";
import { City } from "../entity/City";
import { ObjectId } from "mongodb";

export async function resolveRegions(regions: any[]): Promise<any[]> {
  if (!regions || regions.length === 0) return [];

  const stateRepo = AppDataSource.getMongoRepository(State);
  const cityRepo = AppDataSource.getMongoRepository(City);

  const stateIds: ObjectId[] = [];
  const cityIds: ObjectId[] = [];

  regions.forEach((r) => {
    if (r.state) {
      if (r.state instanceof ObjectId) {
        stateIds.push(r.state);
      } else if (typeof r.state === "string" && ObjectId.isValid(r.state)) {
        stateIds.push(new ObjectId(r.state));
      }
    }
    if (r.city) {
      if (r.city instanceof ObjectId) {
        cityIds.push(r.city);
      } else if (typeof r.city === "string" && ObjectId.isValid(r.city)) {
        cityIds.push(new ObjectId(r.city));
      }
    }
  });

  const uniqueStateIds = Array.from(new Set(stateIds.map(id => id.toString()))).map(id => new ObjectId(id));
  const uniqueCityIds = Array.from(new Set(cityIds.map(id => id.toString()))).map(id => new ObjectId(id));

  const [states, cities] = await Promise.all([
    uniqueStateIds.length > 0 ? stateRepo.find({ where: { _id: { $in: uniqueStateIds } } as any }) : [],
    uniqueCityIds.length > 0 ? cityRepo.find({ where: { _id: { $in: uniqueCityIds } } as any }) : []
  ]);

  const stateMap = new Map(states.map(s => [s._id.toString(), s.name]));
  const cityMap = new Map(cities.map(c => [c._id.toString(), c.name]));

  return regions.map((r) => {
    // If the region object is a TypeORM class instance, we convert it to a plain object first
    const plain = typeof r.toPlain === "function" ? r.toPlain() : JSON.parse(JSON.stringify(r));
    const stateIdStr = r.state ? r.state.toString() : "";
    const cityIdStr = r.city ? r.city.toString() : "";
    return {
      ...plain,
      state: stateMap.get(stateIdStr) || plain.state,
      city: cityMap.get(cityIdStr) || plain.city
    };
  });
}

export async function resolveRegion(region: any): Promise<any> {
  if (!region) return null;
  const resolved = await resolveRegions([region]);
  return resolved[0];
}
