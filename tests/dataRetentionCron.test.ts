import { DataRetentionCronService } from "../src/services/dataRetentionCron.service";
import { AppDataSource } from "../src/data-source";
import { PostModel } from "../src/entity/Post";
import { SavedPost } from "../src/entity/SavedPost";
import { PostReport } from "../src/entity/PostReport";
import imageService from "../src/utils/upload";
import cron from "node-cron";
import { ObjectId } from "mongodb";

jest.mock("node-cron", () => ({
  schedule: jest.fn()
}));

jest.mock("../src/utils/upload", () => ({
  cleanupFiles: jest.fn().mockResolvedValue(true),
  deleteMultipleFromS3: jest.fn().mockResolvedValue(true)
}));

describe("DataRetentionCronService", () => {
  let mockPostFind: jest.Mock;
  let mockPostDeleteMany: jest.Mock;
  let mockSavedPostDeleteMany: jest.Mock;
  let mockPostReportDeleteMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPostFind = jest.fn().mockResolvedValue([]);
    mockPostDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 2 });
    mockSavedPostDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 5 });
    mockPostReportDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === PostModel) {
        return {
          find: mockPostFind,
          deleteMany: mockPostDeleteMany
        } as any;
      }
      if (entity === SavedPost) {
        return {
          deleteMany: mockSavedPostDeleteMany
        } as any;
      }
      if (entity === PostReport) {
        return {
          deleteMany: mockPostReportDeleteMany
        } as any;
      }
      return {} as any;
    });

    (DataRetentionCronService as any).postRepo = {
      find: mockPostFind,
      deleteMany: mockPostDeleteMany
    };
    (DataRetentionCronService as any).savedPostRepo = {
      deleteMany: mockSavedPostDeleteMany
    };
    (DataRetentionCronService as any).postReportRepo = {
      deleteMany: mockPostReportDeleteMany
    };
  });

  describe("init", () => {
    it("should schedule the cron job for 1:00 AM Asia/Kolkata", () => {
      DataRetentionCronService.init();

      expect(cron.schedule).toHaveBeenCalledTimes(1);
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 1 * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
    });
  });

  describe("cleanupExpiredData", () => {
    it("should find posts older than 1 year, clean up S3 media, and delete posts & saved posts", async () => {
      const postId1 = new ObjectId();
      const postId2 = new ObjectId();

      const expiredPosts = [
        {
          _id: postId1,
          title: "Old Post 1",
          media: ["/posts/media1.jpg", "/posts/media2.png"],
          createdAt: new Date("2024-01-01")
        },
        {
          _id: postId2,
          title: "Old Post 2",
          media: ["/posts/media3.jpg"],
          createdAt: new Date("2024-02-01")
        }
      ];

      mockPostFind.mockResolvedValue(expiredPosts);

      const result = await DataRetentionCronService.cleanupExpiredData();

      expect(mockPostFind).toHaveBeenCalledTimes(1);
      const findQuery = mockPostFind.mock.calls[0][0];

      // Check 1-year cutoff query
      const cutoffDate = findQuery.where.createdAt.$lte;
      expect(cutoffDate).toBeInstanceOf(Date);
      const diffYears = new Date().getFullYear() - cutoffDate.getFullYear();
      expect(diffYears).toBeGreaterThanOrEqual(1);

      // S3 cleanup should be invoked with all media files
      expect(imageService.cleanupFiles).toHaveBeenCalledWith([
        "/posts/media1.jpg",
        "/posts/media2.png",
        "/posts/media3.jpg"
      ]);

      // Saved posts referencing expired posts should be deleted
      expect(mockSavedPostDeleteMany).toHaveBeenCalledWith({
        postId: { $in: [postId1, postId2] }
      });

      // Post reports referencing expired posts should be deleted
      expect(mockPostReportDeleteMany).toHaveBeenCalledWith({
        postId: { $in: [postId1, postId2] }
      });

      // Posts themselves should be permanently deleted
      expect(mockPostDeleteMany).toHaveBeenCalledWith({
        _id: { $in: [postId1, postId2] }
      });

      // Old saved posts (> 1 year) should also be deleted
      expect(mockSavedPostDeleteMany).toHaveBeenCalledWith({
        createdAt: { $lte: expect.any(Date) }
      });

      expect(result.expiredPostsCount).toBe(2);
    });

    it("should handle scenario when no expired posts are found", async () => {
      mockPostFind.mockResolvedValue([]);

      const result = await DataRetentionCronService.cleanupExpiredData();

      expect(imageService.cleanupFiles).not.toHaveBeenCalled();
      expect(mockPostDeleteMany).not.toHaveBeenCalled();
      expect(result.expiredPostsCount).toBe(0);
    });
  });
});
