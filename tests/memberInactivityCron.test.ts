import { MemberInactivityCronService } from "../src/services/memberInactivityCron.service";
import { AppDataSource } from "../src/data-source";
import { Member, MemberStatus } from "../src/entity/Member";
import { PushNotification, NotificationModule } from "../src/entity/PushNotifications";
import * as pushNotificationService from "../src/services/pushnotification.service";
import cron from "node-cron";
import { ObjectId } from "mongodb";

jest.mock("node-cron", () => ({
  schedule: jest.fn()
}));

jest.mock("../src/services/pushnotification.service", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true)
}));

describe("MemberInactivityCronService", () => {
  let mockUpdateMany: jest.Mock;
  let mockFind: jest.Mock;
  let mockInsertMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });
    mockFind = jest.fn().mockResolvedValue([]);
    mockInsertMany = jest.fn().mockResolvedValue({ insertedCount: 2 });

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Member) {
        return {
          updateMany: mockUpdateMany,
          find: mockFind
        } as any;
      }
      if (entity === PushNotification) {
        return {
          insertMany: mockInsertMany
        } as any;
      }
      return {} as any;
    });

    (MemberInactivityCronService as any).memberRepo = {
      updateMany: mockUpdateMany,
      find: mockFind
    };

    (MemberInactivityCronService as any).notificationRepo = {
      insertMany: mockInsertMany
    };
  });

  describe("init", () => {
    it("should schedule both the 12:01 AM deactivation and 9:00 AM reminder cron jobs", () => {
      MemberInactivityCronService.init();

      expect(cron.schedule).toHaveBeenCalledTimes(2);

      // 12:01 AM job
      expect(cron.schedule).toHaveBeenCalledWith(
        "1 0 * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );

      // 09:00 AM job
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 9 * * *",
        expect.any(Function),
        { timezone: "Asia/Kolkata" }
      );
    });
  });

  describe("deactivateInactiveMembers", () => {
    it("should query for active members not logged in for 15+ days and set status to inactive", async () => {
      const result = await MemberInactivityCronService.deactivateInactiveMembers();

      expect(mockUpdateMany).toHaveBeenCalledTimes(1);

      const [filter, update] = mockUpdateMany.mock.calls[0];

      expect(filter.status).toBe(MemberStatus.ACTIVE);
      expect(filter.isDeleted).toBe(false);
      expect(filter.$or).toBeDefined();
      expect(filter.$or).toHaveLength(3);

      const cutoffDate = filter.$or[0].lastLoggedIn.$lt;
      expect(cutoffDate).toBeInstanceOf(Date);

      const now = new Date();
      const diffInDays = Math.round((now.getTime() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffInDays).toBe(15);

      expect(update.$set.status).toBe(MemberStatus.INACTIVE);
      expect(result.modifiedCount).toBe(3);
    });
  });

  describe("sendInactivityReminders", () => {
    it("should find active members inactive for 5+ days and send push notifications and insert in-app records", async () => {
      const sampleMember1 = {
        _id: new ObjectId(),
        fullName: "John Doe",
        fcmToken: "fcm-token-1",
        status: MemberStatus.ACTIVE,
        isDeleted: false
      };
      const sampleMember2 = {
        _id: new ObjectId(),
        fullName: "Jane Smith",
        fcmToken: null,
        status: MemberStatus.ACTIVE,
        isDeleted: false
      };

      mockFind.mockResolvedValue([sampleMember1, sampleMember2]);

      await MemberInactivityCronService.sendInactivityReminders();

      expect(mockFind).toHaveBeenCalledTimes(1);

      const findQuery = mockFind.mock.calls[0][0];
      expect(findQuery.where.status).toBe(MemberStatus.ACTIVE);
      expect(findQuery.where.isDeleted).toBe(false);
      expect(findQuery.where.$or).toBeDefined();

      const fiveDayCutoff = findQuery.where.$or[0].lastLoggedIn.$lte;
      expect(fiveDayCutoff).toBeInstanceOf(Date);
      const diffInDays = Math.round((Date.now() - fiveDayCutoff.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffInDays).toBe(5);

      // Verify in-app notifications inserted for all 2 members
      expect(mockInsertMany).toHaveBeenCalledTimes(1);
      const insertedNotifications = mockInsertMany.mock.calls[0][0];
      expect(insertedNotifications).toHaveLength(2);
      expect(insertedNotifications[0].moduleName).toBe(NotificationModule.REMINDER);

      // Verify push notification sent to member with FCM token
      expect(pushNotificationService.sendPushNotification).toHaveBeenCalledTimes(1);
      expect(pushNotificationService.sendPushNotification).toHaveBeenCalledWith(
        "fcm-token-1",
        "We Miss You! Stay Connected",
        expect.objectContaining({
          moduleName: NotificationModule.REMINDER
        })
      );
    });

    it("should handle scenario when no inactive members are found", async () => {
      mockFind.mockResolvedValue([]);

      await MemberInactivityCronService.sendInactivityReminders();

      expect(mockInsertMany).not.toHaveBeenCalled();
      expect(pushNotificationService.sendPushNotification).not.toHaveBeenCalled();
    });
  });
});
