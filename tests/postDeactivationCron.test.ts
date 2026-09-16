import { PostDeactivationCronService } from "../src/services/postDeactivationCron.service";
import { AppDataSource } from "../src/data-source";
import { PostModel, PostType } from "../src/entity/Post";
import cron from "node-cron";

jest.mock("node-cron", () => ({
  schedule: jest.fn()
}));

describe("PostDeactivationCronService", () => {
  let mockUpdateMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === PostModel) {
        return {
          updateMany: mockUpdateMany
        } as any;
      }
      return {} as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("init", () => {
    it("should schedule the 12:01 AM cron job and run startup check", () => {
      const deactivateSpy = jest.spyOn(PostDeactivationCronService, "deactivateExpiredPosts").mockResolvedValue({ modifiedCount: 0 } as any);

      PostDeactivationCronService.init();

      expect(deactivateSpy).toHaveBeenCalled();
      expect(cron.schedule).toHaveBeenCalledWith(
        "1 0 * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
    });
  });

  describe("deactivateExpiredPosts", () => {
    it("should deactivate active promotion and ask posts older than 10 days", async () => {
      const result = await PostDeactivationCronService.deactivateExpiredPosts();

      expect(mockUpdateMany).toHaveBeenCalledTimes(1);

      const [filter, update] = mockUpdateMany.mock.calls[0];

      expect(filter.type).toEqual({ $in: [PostType.PROMOTION, PostType.ASK] });
      expect(filter.isActive).toBe(true);
      expect(filter.isDeleted).toBe(false);
      expect(filter.createdAt.$lte).toBeInstanceOf(Date);

      // Verify the cutoff is approximately 10 days ago (within 5 seconds tolerance)
      const expectedCutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
      expect(Math.abs(filter.createdAt.$lte.getTime() - expectedCutoff)).toBeLessThan(5000);

      expect(update.$set).toEqual(
        expect.objectContaining({
          isActive: false,
          status: "inactive",
          statusReason: "Deactivated due to time expiration",
          updatedAt: expect.any(Date)
        })
      );

      expect(result.modifiedCount).toBe(3);
    });
  });
});
