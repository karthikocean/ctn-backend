export interface IDeepLinkService {
  /**
   * Generates a deep link URL for a referral code
   * @param referralCode The user's unique referral code
   */
  createReferralLink(referralCode: string): Promise<string>;
}
