import { hasPermission } from "../utils/common.function";
import { AppDataSource } from "../data-source";
import { ObjectId } from "mongodb";
import { Role } from "../entity/Role.Permission";

export const canAccess = (feature: string, action: any) => {
  return async (req: any, res: any, next: () => void) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized: No user session found" });
      }

      // req.user.roleId is set by AuthMiddleware from JWT or database
      const roleId = req.user.roleId || req.user.role?._id;

      if (!roleId) {
        return res.status(403).json({ message: "Permission denied: Role not found" });
      }

      // Fetch full role with permissions from database
      const role = await AppDataSource.getMongoRepository(Role).findOneBy({
        _id: new ObjectId(roleId),
        isDeleted: false
      });

      if (!role) {
        return res.status(403).json({ message: "Permission denied: Role is inactive or removed" });
      }

      if (!hasPermission(role, feature, action) && role.name !== "Super Admin") {
        return res.status(403).json({ message: "Permission denied: Insufficient permissions" });
      }

      // Attach role to req for downstream use
      req.user.role = role;
      next();
    } catch (error: any) {
      console.error(`Permission Middleware Error [${feature}:${action}]:`, error.message);
      return res.status(500).json({
        message: "Authentication error",
        error: error.message
      });
    }
  };
};
