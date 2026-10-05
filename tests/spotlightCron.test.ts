import { SpotlightCronService } from "../src/services/spotlightCron.service";
import { SpotlightRequestCronService } from "../src/services/spotlightRequestCron.service";
import { AppDataSource } from "../src/data-source";
import { Spotlight, SpotlightStatus } from "../src/entity/Spotlight";
import { SpotlightRequest, SpotlightRequestStatus } from "../src/entity/SpotlightRequest";
import { SpotlightHistory, SpotlightHistoryAction } from "../src/entity/SpotlightHistory";
import { ObjectId } from "mongodb";
import cron from "node-cron";

jest.mock("node-cron", () => ({
  schedule: jest.fn()
}));

describe("Spotlight Cron Services", () => {
  let mockSpotlightUpdateMany: jest.Mock;
  let mockSpotlightFind: jest.Mock;
  let mockSpotlightFindOne: jest.Mock;
  let mockSpotlightSave: jest.Mock;

  let mockRequestFind: jest.Mock;
  let mockRequestUpdateMany: jest.Mock;

  let mockHistorySave: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSpotlightUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    mockSpotlightFind = jest.fn().mockResolvedValue([]);
    mockSpotlightFindOne = jest.fn().mockResolvedValue(null);
    mockSpotlightSave = jest.fn().mockImplementation((entity) => Promise.resolve({
      ...entity,
      _id: entity._id || new ObjectId()
    }));

    mockRequestFind = jest.fn().mockResolvedValue([]);
    mockRequestUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    mockHistorySave = jest.fn().mockImplementation((entity) => Promise.resolve({
      ...entity,
      _id: new ObjectId()
    }));

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Spotlight) {
        return {
          updateMany: mockSpotlightUpdateMany,
          find: mockSpotlightFind,
          findOne: mockSpotlightFindOne,
          save: mockSpotlightSave
        } as any;
      }
      if (entity === SpotlightRequest) {
        return {
          find: mockRequestFind,
          updateMany: mockRequestUpdateMany
        } as any;
      }
      if (entity === SpotlightHistory) {
        return {
          save: mockHistorySave
        } as any;
      }
      return {} as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("SpotlightCronService", () => {
    it("should initialize cron jobs and trigger startup checks", () => {
      const activateSpy = jest.spyOn(SpotlightCronService, "activateScheduledSpotlights").mockResolvedValue({ modifiedCount: 0 } as any);
      const deactivateSpy = jest.spyOn(SpotlightCronService, "deactivateExpiredSpotlights").mockResolvedValue({ modifiedCount: 0 } as any);

      SpotlightCronService.init();

      expect(activateSpy).toHaveBeenCalled();
      expect(deactivateSpy).toHaveBeenCalled();

      // Checks that daily 12:01 AM cron was scheduled
      expect(cron.schedule).toHaveBeenCalledWith(
        "1 0 * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
    });

    it("should activate scheduled spotlights due on or before today's IST end", async () => {
      await SpotlightCronService.activateScheduledSpotlights();

      expect(mockSpotlightUpdateMany).toHaveBeenCalledTimes(1);
      const [filter, update] = mockSpotlightUpdateMany.mock.calls[0];

      expect(filter.status).toBe(SpotlightStatus.SCHEDULE);
      expect(filter.isDeleted).toBe(false);
      expect(filter.scheduleDate.$lte).toBeInstanceOf(Date);
      expect(update).toEqual({ $set: { status: SpotlightStatus.ACTIVE } });
    });

    it("should deactivate active spotlights that have expired", async () => {
      const pastDate = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 hours ago
      const mockExpiredSpotlight = {
        _id: new ObjectId(),
        scheduleDate: pastDate,
        status: SpotlightStatus.ACTIVE,
        isDeleted: false
      };

      mockSpotlightFind.mockResolvedValue([mockExpiredSpotlight]);

      await SpotlightCronService.deactivateExpiredSpotlights();

      expect(mockSpotlightUpdateMany).toHaveBeenCalledWith(
        { _id: { $in: [mockExpiredSpotlight._id] } },
        { $set: { status: SpotlightStatus.INACTIVE } }
      );
    });
  });

  describe("SpotlightRequestCronService", () => {
    it("should initialize cron jobs and trigger startup auto-creation check", () => {
      const createSpy = jest.spyOn(SpotlightRequestCronService, "createSpotlightFromYesterdayRequests").mockResolvedValue(undefined as any);

      SpotlightRequestCronService.init();

      expect(createSpy).toHaveBeenCalled();
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 1 * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 * * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
    });

    it("should auto-create active spotlight from pending requests created up to yesterday", async () => {
      const member1Id = new ObjectId();
      const member2Id = new ObjectId();
      const req1Id = new ObjectId();
      const req2Id = new ObjectId();

      mockRequestFind.mockResolvedValue([
        { _id: req1Id, memberId: member1Id, status: SpotlightRequestStatus.PENDING, isDeleted: false },
        { _id: req2Id, memberId: member2Id, status: SpotlightRequestStatus.PENDING, isDeleted: false }
      ]);

      const result = await SpotlightRequestCronService.createSpotlightFromYesterdayRequests();

      expect(mockRequestFind).toHaveBeenCalledTimes(1);
      const [filter] = mockRequestFind.mock.calls[0];
      expect(filter.where.status).toBe(SpotlightRequestStatus.PENDING);
      expect(filter.where.isDeleted).toBe(false);
      expect(filter.where.createdAt.$lte).toBeInstanceOf(Date);

      // Verify a new active spotlight was saved
      expect(mockSpotlightSave).toHaveBeenCalled();
      expect(result?.status).toBe(SpotlightStatus.ACTIVE);
      expect(result?.members).toEqual([member1Id, member2Id]);

      // Verify requests were updated to APPROVED
      expect(mockRequestUpdateMany).toHaveBeenCalledWith(
        { _id: { $in: [req1Id, req2Id] } },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: SpotlightRequestStatus.APPROVED
          })
        })
      );

      // Verify history logs were created
      expect(mockHistorySave).toHaveBeenCalledTimes(2);
    });

    it("should merge members if an active spotlight already exists for today", async () => {
      const existingMemberId = new ObjectId();
      const newMemberId = new ObjectId();
      const existingSpotlight = {
        _id: new ObjectId(),
        members: [existingMemberId],
        scheduleDate: new Date(),
        status: SpotlightStatus.SCHEDULE,
        isDeleted: false
      };

      mockSpotlightFindOne.mockResolvedValue(existingSpotlight);
      mockRequestFind.mockResolvedValue([
        { _id: new ObjectId(), memberId: newMemberId, status: SpotlightRequestStatus.PENDING, isDeleted: false }
      ]);

      const result = await SpotlightRequestCronService.createSpotlightFromYesterdayRequests();

      expect(mockSpotlightSave).toHaveBeenCalled();
      expect(result?.members.length).toBe(2);
      expect(result?.status).toBe(SpotlightStatus.ACTIVE);
    });

    it("should soft delete pending requests older than 48 hours", async () => {
      await SpotlightRequestCronService.softDeleteExpiredRequests();

      expect(mockRequestUpdateMany).toHaveBeenCalledTimes(1);
      const [filter, update] = mockRequestUpdateMany.mock.calls[0];

      expect(filter.status).toBe(SpotlightRequestStatus.PENDING);
      expect(filter.isDeleted).toBe(false);
      expect(filter.createdAt.$lte).toBeInstanceOf(Date);
      expect(update).toEqual({ $set: { isDeleted: true } });
    });
  });
});
