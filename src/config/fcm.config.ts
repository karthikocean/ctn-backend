import { JWT } from "google-auth-library";
import path from "path";
import fs from "fs";

export class FcmAuthManager {
  private static instance: FcmAuthManager;
  private jwtClient: JWT | null = null;
  private cachedAccessToken: string | null = null;
  private tokenExpiryTime: number = 0;
  private projectId: string = "tn-business-forum";

  private constructor() {
    this.initClient();
  }

  public static getInstance(): FcmAuthManager {
    if (!FcmAuthManager.instance) {
      FcmAuthManager.instance = new FcmAuthManager();
    }
    return FcmAuthManager.instance;
  }

  private initClient(): void {
    const serviceAccountPath = path.join(__dirname, "../views", "google-firebase.json");
    try {
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
        this.projectId = serviceAccount.project_id || "tn-business-forum";
        this.jwtClient = new JWT({
          email: serviceAccount.client_email,
          key: serviceAccount.private_key,
          scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
        });
        console.log(`✅ [FCM Auth] Initialized for project: ${this.projectId}`);
      } else {
        console.warn(`⚠️ [FCM Auth] Service account file not found at ${serviceAccountPath}`);
      }
    } catch (error: any) {
      console.error("❌ [FCM Auth] Initialization error:", error.message);
    }
  }

  /**
   * Returns a cached Google OAuth2 Access Token.
   * Generates a new token ONLY if missing or expiring within 5 minutes.
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Refresh token 5 minutes before actual expiry (default OAuth2 token lasts 1 hour)
    if (this.cachedAccessToken && now < this.tokenExpiryTime - 5 * 60 * 1000) {
      return this.cachedAccessToken;
    }

    if (!this.jwtClient) {
      throw new Error("FCM JWT Client is not initialized.");
    }

    const { token } = await this.jwtClient.getAccessToken();
    if (!token) {
      throw new Error("Failed to retrieve FCM access token from Google Auth");
    }

    this.cachedAccessToken = token;
    // Set 1-hour expiry from now
    this.tokenExpiryTime = now + 3600 * 1000;
    console.log("🔑 [FCM Auth] Refreshed FCM OAuth2 Access Token");
    return this.cachedAccessToken;
  }

  public getEndpointUrl(): string {
    return `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
  }
}
