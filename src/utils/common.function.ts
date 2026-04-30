import { ObjectId } from "mongodb";
import { Role } from "../entity/Role.Permission";

export function hasPermission(
  role: Role | undefined,
  moduleId: string | ObjectId,
  action: "view" | "add" | "edit" | "delete" | "approve"
): boolean {
  if (!role?.permissions?.length) return false;

  const moduleObjectId =
        typeof moduleId === "string" ? new ObjectId(moduleId) : moduleId;

  const permission = role.permissions.find(
    p => p.moduleId.toString() === moduleObjectId.toString()
  );

  // Treat 'approve' as 'edit' for now (approval is a form of edit)
  // Future: add 'approve' action to Role permissions schema
  const checkAction = action === "approve" ? "edit" : action;

  return Boolean(permission?.actions?.includes(checkAction));
}
function calculateYearsBetween(start: Date, end: Date): number {
  const startDate = new Date(start);
  const endDate = new Date(end);

  let years = endDate.getFullYear() - startDate.getFullYear();

  const anniversary =
    new Date(startDate);
  anniversary.setFullYear(startDate.getFullYear() + years);

  if (endDate < anniversary) {
    years -= 1;
  }

  return Math.max(years, 1);
}
export { calculateYearsBetween };
