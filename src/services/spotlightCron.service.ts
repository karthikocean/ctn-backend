import cron from "node-cron";
import { AppDataSource } from "../data-source";
import { Spotlight, SpotlightStatus } from "../entity/Spotlight";
import { AdminUser } from "../entity/AdminUser";
import { Role } from "../entity/Role.Permission";
import { ObjectId } from "mongodb";

export class SpotlightCronService {
  private static spotlightRepo = AppDataSource.getMongoRepository(Spotlight);

  /**
   * Initializes the Spotlight related cron jobs
   */
  static init() {
    console.log("⏰ Initializing Spotlight Cron Jobs...");

    // ✅ Spotlight Activation Cron - Runs every day at 12:01 AM
    cron.schedule("1 0 * * *", async () => {
      try {
        console.log("🕒 Running Spotlight Activation Cron...");
        await this.activateScheduledSpotlights();
      } catch (error: any) {
        console.error("❌ Spotlight Activation Cron Failed:", error.message);
      }
    });

    // ✅ Spotlight Deactivation Cron - Runs every minute
    cron.schedule("* * * * *", async () => {
      try {
        await this.deactivateExpiredSpotlights();
      } catch (error: any) {
        console.error("❌ Spotlight Deactivation Cron Failed:", error.message);
      }
    });
  }

  /**
   * Activate spotlights scheduled for today or earlier
   */
  static async activateScheduledSpotlights() {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const result = await this.spotlightRepo.updateMany(
      {
        scheduleDate: { $lte: todayEnd },
        status: SpotlightStatus.SCHEDULE,
        isDeleted: false
      },
      { $set: { status: SpotlightStatus.ACTIVE } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Spotlight Activation: ${result.modifiedCount} records set to active.`);
    }
  }

  /**
   * Deactivate active spotlights whose scheduleDate has expired.
   * Spotlights created by users with a franchiseOwner role (role code matches /franchise|franchies/i)
   * expire after 48 hours, while others expire after 24 hours of their scheduleDate.
   */
  static async deactivateExpiredSpotlights() {
    try {
      const activeSpotlights = await this.spotlightRepo.find({
        where: {
          status: SpotlightStatus.ACTIVE,
          isDeleted: false
        }
      });

      if (activeSpotlights.length === 0) return;

      const now = new Date();

      // Gather all creatorIds to query user roles in one go
      const creatorIds = activeSpotlights
        .map(s => s.createdBy)
        .filter((id): id is ObjectId => !!id);

      const userToRoleCodeMap = new Map<string, string>();

      if (creatorIds.length > 0) {
        const adminUserRepo = AppDataSource.getMongoRepository(AdminUser);
        const roleRepo = AppDataSource.getMongoRepository(Role);

        // Fetch creators
        const creators = await adminUserRepo.find({
          where: { _id: { $in: creatorIds } } as any
        });

        const roleIds = creators
          .map(c => c.roleId)
          .filter((id): id is ObjectId => !!id);

        if (roleIds.length > 0) {
          const roles = await roleRepo.find({
            where: { _id: { $in: roleIds } } as any
          });

          const roleMap = new Map(roles.map(r => [r._id.toString(), r.code]));

          for (const creator of creators) {
            if (creator.roleId) {
              const code = roleMap.get(creator.roleId.toString());
              if (code) {
                userToRoleCodeMap.set(creator.id.toString(), code);
              }
            }
          }
        }
      }

      const deactivatedIds: ObjectId[] = [];

      for (const spotlight of activeSpotlights) {
        const creatorIdStr = spotlight.createdBy?.toString();
        const roleCode = creatorIdStr ? userToRoleCodeMap.get(creatorIdStr) : null;

        // Check if role is franchise owner (case-insensitive)
        const isFranchiseOwner = roleCode ? /franchise|franchies/i.test(roleCode) : false;

        const expireHours = isFranchiseOwner ? 48 : 24;
        const expireTime = new Date(spotlight.scheduleDate.getTime() + expireHours * 60 * 60 * 1000);

        if (now >= expireTime) {
          deactivatedIds.push(spotlight._id);
        }
      }

      if (deactivatedIds.length > 0) {
        const result = await this.spotlightRepo.updateMany(
          { _id: { $in: deactivatedIds } } as any,
          {
            $set: {
              status: SpotlightStatus.INACTIVE
            }
          }
        );

        if (result.modifiedCount > 0) {
          console.log(`✅ Spotlight Deactivation: ${result.modifiedCount} records set to inactive.`);
        }
      }
    } catch (error: any) {
      console.error("❌ Spotlight Deactivation Failed:", error.message);
    }
  }
}
