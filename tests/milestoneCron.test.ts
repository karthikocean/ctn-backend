import { MilestoneCronService } from "../src/services/milestoneCron.service";
import { AppDataSource } from "../src/data-source";
import { Milestone } from "../src/entity/Milestone";
import { MilestoneView } from "../src/entity/MilestoneView";
import imageService from "../src/utils/upload";
import cron from "node-cron";
import { ObjectId } from "mongodb";

jest.mock("node-cron", () => ({
  schedule: jest.fn()
}));

jest.mock("../src/utils/upload", () => ({
  cleanupFiles: jest.fn().mockResolvedValue(true)
}));

describe("MilestoneCronService", () => {
  let mockMilestoneFind: jest.Mock;
  let mockMilestoneDeleteMany: jest.Mock;
  let mockViewDeleteMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMilestoneFind = jest.fn().mockResolvedValue([]);
    mockMilestoneDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 2 });
    mockViewDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 4 });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Milestone) {
        return {
          find: mockMilestoneFind,
          deleteMany: mockMilestoneDeleteMany
        } as any;
      }
      if (entity === MilestoneView) {
        return {
          deleteMany: mockViewDeleteMany
        } as any;
      }
      return {} as any;
    });

    (MilestoneCronService as any).milestoneRepo = {
      find: mockMilestoneFind,
      deleteMany: mockMilestoneDeleteMany
    };
    (MilestoneCronService as any).milestoneViewRepo = {
      deleteMany: mockViewDeleteMany
    };
  });

  describe("init", () => {
    it("should schedule the cron job to run every 10 minutes", () => {
      MilestoneCronService.init();

      expect(cron.schedule).toHaveBeenCalledTimes(1);
      expect(cron.schedule).toHaveBeenCalledWith(
        "*/10 * * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
    });
  });

  describe("deleteExpiredMilestones", () => {
    it("should permanently delete expired milestones, purge S3 media files, and delete milestone views", async () => {
      const milestoneId1 = new ObjectId();
      const milestoneId2 = new ObjectId();

      const expiredMilestones = [
        {
          _id: milestoneId1,
          caption: "Milestone 1",
          mediaUrl: "/milestones/img1.jpg",
          expiresAt: new Date(Date.now() - 1000)
        },
        {
          _id: milestoneId2,
          caption: "Milestone 2",
          mediaUrl: "/milestones/video1.mp4",
          expiresAt: new Date(Date.now() - 2000)
        }
      ];

      mockMilestoneFind.mockResolvedValue(expiredMilestones);

      const result = await MilestoneCronService.deleteExpiredMilestones();

      expect(mockMilestoneFind).toHaveBeenCalledTimes(1);

      // Verify S3 media cleanup called
      expect(imageService.cleanupFiles).toHaveBeenCalledWith([
        "/milestones/img1.jpg",
        "/milestones/video1.mp4"
      ]);

      // Verify milestone views deleted
      expect(mockViewDeleteMany).toHaveBeenCalledWith({
        milestoneId: { $in: [milestoneId1, milestoneId2] }
      });

      // Verify milestones permanently deleted
      expect(mockMilestoneDeleteMany).toHaveBeenCalledWith({
        _id: { $in: [milestoneId1, milestoneId2] }
      });

      expect(result.deletedCount).toBe(2);
      expect(result.mediaDeletedCount).toBe(2);
    });

    it("should handle scenario when no expired milestones exist", async () => {
      mockMilestoneFind.mockResolvedValue([]);

      const result = await MilestoneCronService.deleteExpiredMilestones();

      expect(imageService.cleanupFiles).not.toHaveBeenCalled();
      expect(mockMilestoneDeleteMany).not.toHaveBeenCalled();
      expect(result.deletedCount).toBe(0);
      expect(result.mediaDeletedCount).toBe(0);
    });
  });
});
