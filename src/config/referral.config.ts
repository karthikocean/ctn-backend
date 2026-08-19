export enum ReferralRewardCondition {
  ON_REGISTRATION = "ON_REGISTRATION",
  ON_FIRST_ORDER = "ON_FIRST_ORDER",
  ON_FIRST_PAYMENT = "ON_FIRST_PAYMENT",
  ON_VERIFIED_ACCOUNT = "ON_VERIFIED_ACCOUNT"
}

export interface ReferralConfig {
  referrerReward: number;
  referredUserReward: number;
  baseUrl: string;
  rewardCondition: ReferralRewardCondition;
  deepLinkProvider: "default" | "depl";
  deplApiKey?: string;
  deplProjectId?: string;
}

export const REFERRAL_CONFIG: ReferralConfig = {
  referrerReward: Number(process.env.REFERRAL_REFERRER_REWARD) || 50,
  referredUserReward: Number(process.env.REFERRAL_USER_REWARD) || 20,
  baseUrl: process.env.REFERRAL_BASE_URL || "https://trustednetwork.in/ref",
  rewardCondition: (process.env.REFERRAL_REWARD_CONDITION as ReferralRewardCondition) || ReferralRewardCondition.ON_REGISTRATION,
  deepLinkProvider: (process.env.DEEP_LINK_PROVIDER as "default" | "depl") || "default",
  deplApiKey: process.env.DEPL_API_KEY,
  deplProjectId: process.env.DEPL_PROJECT_ID
};
