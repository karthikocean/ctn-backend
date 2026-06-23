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
