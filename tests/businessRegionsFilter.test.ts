import { ObjectId } from "mongodb";
import { CommonController } from "../src/controllers/mobile/CommonController";
import { AppDataSource } from "../src/data-source";

describe("GET /mobile-api/common/business-regions - Search Filter Tests", () => {
  let controller: CommonController;
  let mockRes: any;
  let resJson: jest.Mock;
  let resStatus: jest.Mock;

  const mockStateId = new ObjectId();
  const mockCityId1 = new ObjectId();
  const mockCityId2 = new ObjectId();
  const mockAreaId1 = new ObjectId();
  const mockAreaId2 = new ObjectId();
  const mockAreaId3 = new ObjectId();

  beforeEach(() => {
    controller = new CommonController();
    resJson = jest.fn();
    resStatus = jest.fn().mockReturnValue({ json: resJson });
    mockRes = { status: resStatus };
    jest.clearAllMocks();
  });

  test("1. No search filter: returns all areas sorted alphabetically", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([
      { _id: mockCityId1, name: "Bengaluru" }
    ]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: new ObjectId(),
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        areas: [
          { _id: mockAreaId1, name: "Koramangala" },
          { _id: mockAreaId2, name: "Indiranagar" }
        ]
      }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Karnataka", country: "India" }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "City") return { find: mockFindCity } as any;
      if (entity.name === "BusinessRegion") return { find: mockFindRegion } as any;
      if (entity.name === "State") return { find: mockFindState } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });

    await controller.getBusinessRegions(
      mockStateId.toString(),
      "",
      "",
      "",
      1000,
      0,
      mockRes
    );

    expect(resStatus).toHaveBeenCalledWith(200);
    expect(resJson).toHaveBeenCalled();
    const result = resJson.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.data[0].name).toBe("Indiranagar"); // alphabetical sort
    expect(result.data[1].name).toBe("Koramangala");
  });

  test("2. Search by area/region name: returns only areas whose name matches search term", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: new ObjectId(),
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        areas: [
          { _id: mockAreaId1, name: "Koramangala" },
          { _id: mockAreaId2, name: "Indiranagar" }
        ]
      }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Karnataka", country: "India" }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "City") return { find: mockFindCity } as any;
      if (entity.name === "BusinessRegion") return { find: mockFindRegion } as any;
      if (entity.name === "State") return { find: mockFindState } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });

    await controller.getBusinessRegions(
      mockStateId.toString(),
      "",
      "",
      "Koramangala",
      1000,
      0,
      mockRes
    );

    expect(resStatus).toHaveBeenCalledWith(200);
    const result = resJson.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].name).toBe("Koramangala");
  });

  test("3. Search by city name: returns all areas belonging to matched city", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([
      { _id: mockCityId2, name: "Mysore" }
    ]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: new ObjectId(),
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        areas: [
          { _id: mockAreaId1, name: "Whitefield" }
        ]
      },
      {
        _id: new ObjectId(),
        country: "India",
        state: mockStateId,
        city: mockCityId2,
        areas: [
          { _id: mockAreaId2, name: "Gokulam" },
          { _id: mockAreaId3, name: "Jayalakshmipuram" }
        ]
      }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Karnataka", country: "India" }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "City") return { find: mockFindCity } as any;
      if (entity.name === "BusinessRegion") return { find: mockFindRegion } as any;
      if (entity.name === "State") return { find: mockFindState } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });

    await controller.getBusinessRegions(
      mockStateId.toString(),
      "",
      "",
      "Mysore",
      1000,
      0,
      mockRes
    );

    expect(resStatus).toHaveBeenCalledWith(200);
    const result = resJson.mock.calls[0][0];
    expect(result.success).toBe(true);
    // Both areas in Mysore are returned, Whitefield is not
    expect(result.data.length).toBe(2);
    const names = result.data.map((d: any) => d.name);
    expect(names).toContain("Gokulam");
    expect(names).toContain("Jayalakshmipuram");
    expect(names).not.toContain("Whitefield");
  });

  test("4. Search matches both area name and city name", async () => {
    const mockFindCity = jest.fn().mockResolvedValue([
      { _id: mockCityId2, name: "Mysore" }
    ]);
    const mockFindRegion = jest.fn().mockResolvedValue([
      {
        _id: new ObjectId(),
        country: "India",
        state: mockStateId,
        city: mockCityId1,
        areas: [
          { _id: mockAreaId1, name: "Mysore Road Area" },
          { _id: mockAreaId2, name: "Whitefield" }
        ]
      },
      {
        _id: new ObjectId(),
        country: "India",
        state: mockStateId,
        city: mockCityId2,
        areas: [
          { _id: mockAreaId3, name: "Gokulam" }
        ]
      }
    ]);
    const mockFindState = jest.fn().mockResolvedValue([
      { _id: mockStateId, name: "Karnataka", country: "India" }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "City") return { find: mockFindCity } as any;
      if (entity.name === "BusinessRegion") return { find: mockFindRegion } as any;
      if (entity.name === "State") return { find: mockFindState } as any;
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });

    await controller.getBusinessRegions(
      mockStateId.toString(),
      "",
      "",
      "Mysore",
      1000,
      0,
      mockRes
    );

    expect(resStatus).toHaveBeenCalledWith(200);
    const result = resJson.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);
    const names = result.data.map((d: any) => d.name);
    expect(names).toContain("Mysore Road Area");
    expect(names).toContain("Gokulam");
    expect(names).not.toContain("Whitefield");
  });
});
