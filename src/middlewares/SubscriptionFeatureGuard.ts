import { SubscriptionService } from "../services/subscription.service";

const subService = new SubscriptionService();

export const checkFeature = (featureType: string) => {
  return async (req: any, res: any, next: () => void) => {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: No user session found"
        });
      }

      const memberId = req.user.userId;

      // Validate access
      const hasAccess = await subService.checkFeatureAccess(memberId, featureType);

      if (!hasAccess) {
        let msg = "Upgrade subscription plan to access this feature.";
        if (featureType === "maxConnections") {
          msg = "Connection limit reached. Upgrade to a paid plan for unlimited connections.";
        } else if (featureType === "maxMessages") {
          msg = "Message limit reached. Upgrade to a paid plan for unlimited messaging.";
        } else if (featureType === "requirementsAccess") {
          msg = "Upgrade plan to access premium requirements.";
        } else if (featureType === "searchType") {
          msg = "Advanced search is restricted. Upgrade to a paid plan to search.";
        }
        return res.status(403).json({
          success: false,
          message: msg
        });
      }

      next();
    } catch (error: any) {
      console.error(`Subscription Guard Error [${featureType}]:`, error.message);
      return res.status(500).json({
        success: false,
        message: "Subscription validation failed",
        error: error.message
      });
    }
  };
};

export const canAccessPremiumRequirement = () => checkFeature("requirementsAccess");
export const canSendUnlimitedMessages = () => checkFeature("maxMessages");
export const canViewAdvancedSearch = () => checkFeature("searchType");
