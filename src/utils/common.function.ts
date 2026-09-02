import { Role } from "../entity/Role.Permission";
import { AppDataSource } from "../data-source";
import { Module } from "../entity/Module";

export async function hasPermission(
  role: Role | undefined,
  moduleId: string,
  action: "view" | "add" | "edit" | "delete" | "approve" | "create"
): Promise<boolean> {
  if (!role?.permissions?.length) return false;

  // 1. Resolve module using the providedmoduleId (slugName or name)
  let targetModule: Module | null = null;
  try {
    const moduleRepo = AppDataSource.getMongoRepository(Module);
    targetModule = await moduleRepo.findOne({
      where: {
        $or: [
          { slugName: moduleId },
          { name: moduleId }
        ],
        isDelete: 0
      }
    });
  } catch (error) {
    console.error("Error fetching module in hasPermission:", error);
  }

  // 2. Find matching permission
  const permission = role.permissions.find(p => {
    // If the database has a matching module, check if the permission's moduleId matches the module's _id
    if (targetModule && p.moduleId && p.moduleId.toString() === targetModule._id.toString()) {
      return true;
    }
    // Backward compatibility fallback matching using raw string comparisons
    const pModStr = String(p.moduleId).toLowerCase();
    const reqModStr = moduleId.toLowerCase();
    return pModStr === reqModStr ||
           pModStr === reqModStr.replace(/_/g, " ") ||
           pModStr.replace(/ /g, "_") === reqModStr;
  });

  // Treat 'approve' as 'edit' and 'add' as 'create'
  let checkAction = action.toLowerCase();
  if (checkAction === "approve") {
    checkAction = "edit";
  } else if (checkAction === "add") {
    checkAction = "create";
  }

  return Boolean(permission?.actions?.map(a => a.toLowerCase()).includes(checkAction));
}

export { calculateYearsBetween } from "./dateUtils";
