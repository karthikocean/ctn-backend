import { IDeepLinkService } from "./deep-link.interface";
import { DefaultDeepLinkService } from "./default-deep-link.service";
import { DeplDeepLinkService } from "./depl-deep-link.service";
import { REFERRAL_CONFIG } from "../../config/referral.config";

export class DeepLinkFactory {
  private static instance: IDeepLinkService;

  static getService(): IDeepLinkService {
    if (!this.instance) {
      if (REFERRAL_CONFIG.deepLinkProvider === "depl") {
        this.instance = new DeplDeepLinkService();
      } else {
        this.instance = new DefaultDeepLinkService();
      }
    }
    return this.instance;
  }

  /**
   * For unit tests to inject mock providers
   */
  static setService(service: IDeepLinkService): void {
    this.instance = service;
  }
}
