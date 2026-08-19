import axios from "axios";
import { IDeepLinkService } from "./deep-link.interface";
import { REFERRAL_CONFIG } from "../../config/referral.config";

export class DeplDeepLinkService implements IDeepLinkService {
  private apiKey?: string;
  private projectId?: string;
  private fallbackUrl: string;

  constructor() {
    this.apiKey = REFERRAL_CONFIG.deplApiKey;
    this.projectId = REFERRAL_CONFIG.deplProjectId;
    this.fallbackUrl = REFERRAL_CONFIG.baseUrl.replace(/\/+$/, "");
  }

  async createReferralLink(referralCode: string): Promise<string> {
    const normalizedCode = referralCode.trim().toUpperCase();

    if (!this.apiKey || !this.projectId) {
      // Graceful fallback to formatted direct URL if DEPL credentials are not set
      return `${this.fallbackUrl}/${encodeURIComponent(normalizedCode)}`;
    }

    try {
      const response = await axios.post(
        "https://api.depl.io/v1/links",
        {
          projectId: this.projectId,
          url: `${this.fallbackUrl}/${encodeURIComponent(normalizedCode)}`,
          data: {
            referralCode: normalizedCode,
            type: "referral"
          }
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: 4000
        }
      );

      if (response.data && response.data.shortUrl) {
        return response.data.shortUrl;
      }
      return `${this.fallbackUrl}/${encodeURIComponent(normalizedCode)}`;
    } catch (error: any) {
      console.warn(`[DeplDeepLinkService] Failed to generate DEPL link: ${error.message}. Using fallback.`);
      return `${this.fallbackUrl}/${encodeURIComponent(normalizedCode)}`;
    }
  }
}
