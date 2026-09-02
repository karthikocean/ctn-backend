import { AppDataSource } from "../data-source";
import { AdminUser } from "../entity/AdminUser";

export async function generateAdminUserId(): Promise<string> {
  try {
    const lastAdminUser = await AppDataSource.getMongoRepository(AdminUser).findOne({
      where: {},
      order: { createdAt: "DESC" as any }
    });

    const lastId = lastAdminUser?.userId?.replace("US", "") || "000";
    const numeric = parseInt(lastId) || 0;
    const newId = `US${(numeric + 1).toString().padStart(3, "0")}`;
    return newId;
  } catch (err) {
    throw err;
  }
}

