/**
 * Helper utilities for GST business constitution checks and member registration limits.
 */

/**
 * Checks if a given constitution of business or business type represents a Proprietorship.
 * Matches values such as "Proprietorship", "Proprietor", "Sole Proprietorship" case-insensitively.
 */
export const isProprietorship = (type?: string | null): boolean => {
  if (!type || typeof type !== "string") return false;
  const clean = type.trim().toLowerCase();
  return clean === "proprietorship" || clean === "proprietor" || clean === "sole proprietorship";
};

/**
 * Returns the maximum allowed member registrations for a given business type.
 * - Proprietorship: 1 member
 * - Other business types: 2 members
 */
export const getGstMaxAllowedMembers = (isProprietor: boolean): number => {
  return isProprietor ? 1 : 2;
};

/**
 * Returns a standardized error message when the GST registration limit is reached.
 */
export const getGstMaxLimitErrorMessage = (maxAllowed: number): string => {
  if (maxAllowed === 1) {
    return "GST number is already registered with maximum allowed members (1 for Proprietorship)";
  }
  return "GST number is already registered with maximum allowed members (2)";
};
