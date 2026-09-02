/**
 * Tests for FranchiseFilter middleware optimization and lazy member ID loading.
 */

import { ObjectId } from "mongodb";
import { franchiseFilter } from "../src/middlewares/FranchiseFilterMiddleware";
import { AppDataSource } from "../src/data-source";

describe("FranchiseFilter Middleware", () => {
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRes = {};
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  test("1. Non-franchise admin -> isFranchise=false, does not query Member collection", async () => {
    const mockReq: any = {
      user: {
        userId: new ObjectId().toString(),
        role: { code: "SUPER_ADMIN", name: "Super Admin" }
      }
    };

    const findOneFranchise = jest.fn().mockResolvedValue(null);
    const findMembers = jest.fn().mockResolvedValue([]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Franchise") {
        return { findOne: findOneFranchise } as any;
      }
      if (entity.name === "Member") {
        return { find: findMembers } as any;
      }
      return {} as any;
    });

    await franchiseFilter(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.isFranchise).toBe(false);
    expect(mockReq.franchiseAreaIds).toEqual([]);
    // Member collection MUST NOT be queried for non-franchise requests
    expect(findMembers).not.toHaveBeenCalled();
  });

  test("2. Franchise user -> isFranchise=true, areaIds set, member IDs loaded LAZILY on demand", async () => {
    const userId = new ObjectId();
    const regionId = new ObjectId();
    const areaId1 = new ObjectId();
    const areaId2 = new ObjectId();
    const memberId1 = new ObjectId();
    const memberId2 = new ObjectId();

    const mockReq: any = {
      user: {
        userId: userId.toString(),
        role: { code: "FRANCHISE_OWNER", name: "Franchise Owner" }
      }
    };

    const findOneFranchise = jest.fn().mockResolvedValue({
      _id: new ObjectId(),
      userId: [userId],
      businessRegionId: regionId,
      isDeleted: false
    });

    const findOneRegion = jest.fn().mockResolvedValue({
      _id: regionId,
      areas: [{ _id: areaId1 }, { _id: areaId2 }],
      isDeleted: false
    });

    const findMembers = jest.fn().mockResolvedValue([
      { _id: memberId1 },
      { _id: memberId2 }
    ]);

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Franchise") {
        return { findOne: findOneFranchise } as any;
      }
      if (entity.name === "BusinessRegion") {
        return { findOne: findOneRegion } as any;
      }
      if (entity.name === "Member") {
        return { find: findMembers } as any;
      }
      return {} as any;
    });

    await franchiseFilter(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.isFranchise).toBe(true);
    expect(mockReq.franchiseAreaIds.length).toBe(3); // region + 2 areas

    // In the middleware execution itself, memberRepo.find MUST NOT be called eagerly
    expect(findMembers).not.toHaveBeenCalled();

    // When a controller calls getFranchiseMemberIds(), it fetches and caches the IDs
    const memberIds = await mockReq.getFranchiseMemberIds();
    expect(memberIds).toEqual([memberId1, memberId2]);
    expect(findMembers).toHaveBeenCalledTimes(1);

    // Second call uses cached IDs without firing an extra DB query
    const cachedIds = await mockReq.getFranchiseMemberIds();
    expect(cachedIds).toEqual([memberId1, memberId2]);
    expect(findMembers).toHaveBeenCalledTimes(1);
  });

  test("3. Concurrent requests do not share or corrupt request state", async () => {
    const reqA: any = { user: { userId: new ObjectId().toString(), role: { code: "SUPER_ADMIN" } } };
    const reqB: any = { user: { userId: new ObjectId().toString(), role: { code: "FRANCHISE_OWNER" } } };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity.name === "Franchise") {
        return {
          findOne: jest.fn().mockImplementation((opts: any) => {
            if (opts.where.$or[0].userId.$in[0].equals(new ObjectId(reqB.user.userId))) {
              return Promise.resolve({ _id: new ObjectId(), businessRegionId: new ObjectId() });
            }
            return Promise.resolve(null);
          })
        } as any;
      }
      if (entity.name === "BusinessRegion") {
        return { findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), areas: [] }) } as any;
      }
      return { find: jest.fn().mockResolvedValue([]) } as any;
    });

    await Promise.all([
      franchiseFilter(reqA, mockRes, jest.fn()),
      franchiseFilter(reqB, mockRes, jest.fn())
    ]);

    expect(reqA.isFranchise).toBe(false);
    expect(reqB.isFranchise).toBe(true);
  });
});
