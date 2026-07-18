import { ObjectId } from "mongodb";
import { SubscriptionService } from "./subscription.service";

const subscriptionService = new SubscriptionService();

/**
 * Validates whether a member is allowed to use a module based on active plan restrictions.
 * Throws BadRequestError if usage limit is reached or exceeded.
 */
export async function validateModuleUsage(memberId: ObjectId, moduleName: string): Promise<void> {
  await subscriptionService.validateModuleUsage(memberId, moduleName);
}

export async function validateRequirementResponseLimit(memberId: ObjectId): Promise<void> {
  await subscriptionService.validateRequirementResponseLimit(memberId);
}

/**
 * Validates whether a member's active plan has a specific feature flag enabled.
 * @param memberId - The member's ObjectId
 * @param featureKey - The key inside plan.features (e.g. "spotlights", "eventStall")
 * @param featureLabel - Human-readable label used in the error message
 */
export async function validateFeatureAccess(
  memberId: ObjectId,
  featureKey: string,
  featureLabel: string
): Promise<void> {
  const plan = await subscriptionService.getMemberPlan(memberId);
  const features = (plan as any).features ?? {};
  if (!features[featureKey]) {
    throw new Error(`Access denied: "${featureLabel}" is not available in your current subscription plan.`);
  }
}
