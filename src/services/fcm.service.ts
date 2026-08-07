import axios from "axios";
import { FcmAuthManager } from "../config/fcm.config";

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export class FcmService {
  private static authManager = FcmAuthManager.getInstance();

  /**
   * Send FCM HTTP v1 message to a single token
   */
  public static async sendToToken(token: string, payload: FcmPayload): Promise<boolean> {
    if (!token || typeof token !== "string") return false;

    try {
      const accessToken = await this.authManager.getAccessToken();
      const endpoint = this.authManager.getEndpointUrl();

      const message = {
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body ?? "",
          },
          data: payload.data ?? {},
          android: {
            priority: "HIGH",
            notification: {
              sound: "default",
            },
          },
          apns: {
            headers: {
              "apns-priority": "10",
            },
            payload: {
              aps: {
                alert: {
                  title: payload.title,
                  body: payload.body ?? "",
                },
                sound: "default",
                badge: 1,
                "content-available": 1,
              },
            },
          },
        },
      };

      await axios.post(endpoint, message, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      return true;
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status;
        const errDetails = error.response.data?.error?.details || error.response.data?.error?.message;
        // Check if token is invalid/unregistered
        if (status === 404 || status === 400 || (typeof errDetails === "string" && errDetails.includes("UNREGISTERED"))) {
          console.warn(`⚠️ [FCM] Token is invalid/unregistered: ${token.substring(0, 15)}...`);
          return false;
        }
      }
      console.error(`❌ [FCM] Error sending to token ${token.substring(0, 15)}...:`, error.message);
      throw error; // Throw so BullMQ can trigger exponential backoff retry if transient
    }
  }

  /**
   * Send FCM HTTP v1 message to a Topic (e.g. topic "all_members")
   * This is optimal for broadcast messages when 1,000,000 users subscribe to topic.
   */
  public static async sendToTopic(topic: string, payload: FcmPayload): Promise<boolean> {
    try {
      const accessToken = await this.authManager.getAccessToken();
      const endpoint = this.authManager.getEndpointUrl();

      const cleanTopic = topic.replace("/topics/", "");

      const message = {
        message: {
          topic: cleanTopic,
          notification: {
            title: payload.title,
            body: payload.body ?? "",
          },
          data: payload.data ?? {},
          android: {
            priority: "HIGH",
            notification: { sound: "default" },
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: {
              aps: {
                alert: { title: payload.title, body: payload.body ?? "" },
                sound: "default",
              },
            },
          },
        },
      };

      const response = await axios.post(endpoint, message, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      });

      console.log(`✅ [FCM Topic] Successfully broadcast to topic /topics/${cleanTopic}:`, response.data);
      return true;
    } catch (error: any) {
      console.error(`❌ [FCM Topic] Failed to send to topic ${topic}:`, error.message);
      throw error;
    }
  }

  /**
   * Send FCM messages to a batch of tokens using concurrency limit
   */
  public static async sendBatchTokens(tokens: string[], payload: FcmPayload, batchConcurrency = 50): Promise<void> {
    if (!tokens || tokens.length === 0) return;

    for (let i = 0; i < tokens.length; i += batchConcurrency) {
      const batch = tokens.slice(i, i + batchConcurrency);
      await Promise.allSettled(
        batch.map((token) => this.sendToToken(token, payload))
      );
    }
  }
}
