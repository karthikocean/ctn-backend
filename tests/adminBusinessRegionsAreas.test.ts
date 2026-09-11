import { ObjectId } from "mongodb";
import { BusinessRegionController } from "../src/controllers/admin/BusinessRegionController";
import { AppDataSource } from "../src/data-source";

describe("GET /api/admin/business-regions/areas - Admin Areas Endpoint Tests", () => {
  let controller: BusinessRegionController;
  let mockRes: any;
  let resSend: jest.Mock;
  let resStatus: jest.Mock;

  const mockStateId = new ObjectId();
  const mockCityId1 = new ObjectId();
  const mockCityId2 = new ObjectId();
  const mockRegionId1 = new ObjectId();
  const mockRegionId2 = new ObjectId();
  const mockAreaId1 = new ObjectId();
  const mockAreaId2 = new ObjectId();
  const mockAreaId3 = new ObjectId();

  beforeEach(() => {
    controller = new BusinessRegionController();
    resSend = jest.fn();
    resStatus = jest.fn().mockReturnValue({ send: resSend });
    mockRes = { status: resStatus };
    jest.clearAllMocks();
  });

  test("1. Returns all flattened areas with pagination structure and alphabetical sorting", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([
      { _id: mockCityId1, name: "Chennai" }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Tamil Nadu" }
    ]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: mockRegionId1,
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        status: "active",
        areas: [
          { _id: mockAreaId1, name: "Coromandel" },
          { _id: mockAreaId2, name: "Capital" }
        ]
      }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const entityName = typeof entity === "string" ? entity : entity.name;
      if (entityName === "City") return { find: mockFindCity } as any;
      if (entityName === "State") return { find: mockFindState } as any;
      if (entityName === "BusinessRegion" || entityName === "business_regions") return { find: mockFindRegion } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });

    // Replace the controller's internal regionRepo with our mock
    (controller as any).regionRepo = { find: mockFindRegion };

    await controller.getAreas(0, 10, "", "", "", "", "", "active", mockRes);

    expect(resStatus).toHaveBeenCalledWith(200);
    expect(resSend).toHaveBeenCalled();
    const result = resSend.mock.calls[0][0];
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
    // Alphabetical order: Capital, then Coromandel
    expect(result.data[0].name).toBe("Capital");
    expect(result.data[0].city).toBe("Chennai");
    expect(result.data[0].state).toBe("Tamil Nadu");
    expect(result.data[0].businessRegionId).toEqual(mockRegionId1);
    expect(result.data[1].name).toBe("Coromandel");
  });

  test("2. Filter by cityName: returns only areas matching city name filter", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([
      { _id: mockCityId1, name: "Chennai" }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Tamil Nadu" }
    ]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: mockRegionId1,
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        status: "active",
        areas: [
          { _id: mockAreaId1, name: "Capital" }
        ]
      }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const entityName = typeof entity === "string" ? entity : entity.name;
      if (entityName === "City") return { find: mockFindCity } as any;
      if (entityName === "State") return { find: mockFindState } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });
    (controller as any).regionRepo = { find: mockFindRegion };

    await controller.getAreas(0, 10, "", "", "Chennai", "", "", "active", mockRes);

    expect(resStatus).toHaveBeenCalledWith(200);
    const result = resSend.mock.calls[0][0];
    expect(result.total).toBe(1);
    expect(result.data[0].name).toBe("Capital");
    expect(result.data[0].city).toBe("Chennai");
  });

  test("3. Filter by area name: returns only areas matching area name filter", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([
      { _id: mockCityId1, name: "Chennai" }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Tamil Nadu" }
    ]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: mockRegionId1,
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        status: "active",
        areas: [
          { _id: mockAreaId1, name: "Coromandel" },
          { _id: mockAreaId2, name: "Capital" }
        ]
      }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const entityName = typeof entity === "string" ? entity : entity.name;
      if (entityName === "City") return { find: mockFindCity } as any;
      if (entityName === "State") return { find: mockFindState } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });
    (controller as any).regionRepo = { find: mockFindRegion };

    await controller.getAreas(0, 10, "Coromandel", "", "", "", "", "active", mockRes);

    expect(resStatus).toHaveBeenCalledWith(200);
    const result = resSend.mock.calls[0][0];
    expect(result.total).toBe(1);
    expect(result.data[0].name).toBe("Coromandel");
  });

  test("4. Short-circuit: when cityName matches no cities, immediately return empty paginated result", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([]);
    const mockFindRegion = jest.fn();

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      const entityName = typeof entity === "string" ? entity : entity.name;
      if (entityName === "City") return { find: mockFindCity } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });
    (controller as any).regionRepo = { find: mockFindRegion };

    await controller.getAreas(0, 10, "", "", "NonExistentCity", "", "", "active", mockRes);

    expect(resStatus).toHaveBeenCalledWith(200);
    const result = resSend.mock.calls[0][0];
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    expect(mockFindRegion).not.toHaveBeenCalled();
  });
});
