import { hasPermission } from "../utils/common.function";
import { AppDataSource } from "../data-source";
import { ObjectId } from "mongodb";
import { Role } from "../entity/Role.Permission";

export const canAccess = (feature: string, action: any) => {
  return async (req: { user: { roleId: any; role: Role; }; }, res: { status: (arg0: number) => { (): any; new(): any; json: { (arg0: { message: string; error?: any; }): any; new(): any; }; }; }, next: () => void) => {
    try {

      // req.user.roleId is set by AuthMiddleware from JWT
      const roleId = req.user.roleId || req.user.role?._id;

      if (!roleId) {
        return res.status(403).json({ message: "Role not found in token" });
      }

      // Fetch full role with permissions from database
      const role = await AppDataSource.getMongoRepository(Role).findOneBy({
        _id: new ObjectId(roleId),
        isDelete: 0
      });

      if (!role) {
        return res.status(403).json({ message: "Role not found or inactive" });
      }

      if (!hasPermission(role, feature, action) && role.name !== "Super Admin") {
        return res.status(403).json({ message: "Permission denied" });
      }

      // Attach role to req for downstream use
      req.user.role = role;
      next();
    } catch (error: any) {
      if (error.code === "CastError") {
        return res.status(400).json({ message: "Invalid role ID" });
      }
      return res.status(500).json({ message: "Authentication error", error: error.message });
    }
  };
};
