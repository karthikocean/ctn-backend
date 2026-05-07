import { Role } from "../entity/Role.Permission";

export function hasPermission(
  role: Role | undefined,
  moduleId: string,
  action: "view" | "add" | "edit" | "delete" | "approve"
): boolean {
  if (!role?.permissions?.length) return false;

  const permission = role.permissions.find(
    p => String(p.moduleId).toLowerCase() === String(moduleId).toLowerCase()
  );

  // Treat 'approve' as 'edit' for now (approval is a form of edit)
  const checkAction = action === "approve" ? "edit" : action.toLowerCase();

  return Boolean(permission?.actions?.map(a => a.toLowerCase()).includes(checkAction));
}

export function calculateYearsBetween(start: Date, end: Date): number {
  const startDate = new Date(start);
  const endDate = new Date(end);

  let years = endDate.getFullYear() - startDate.getFullYear();

  const anniversary = new Date(startDate);
  anniversary.setFullYear(startDate.getFullYear() + years);

  if (endDate < anniversary) {
    years -= 1;
  }

  return Math.max(years, 1);
}
