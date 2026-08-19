import { IDeepLinkService } from "./deep-link.interface";
import { REFERRAL_CONFIG } from "../../config/referral.config";

export class DefaultDeepLinkService implements IDeepLinkService {
  async createReferralLink(referralCode: string): Promise<string> {
    const baseUrl = REFERRAL_CONFIG.baseUrl.replace(/\/+$/, "");
    return `${baseUrl}/${encodeURIComponent(referralCode.trim().toUpperCase())}`;
  }
}
