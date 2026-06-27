import { JWT } from "google-auth-library";
import axios from "axios";
import path from "path";
import * as fs from "fs";
import { ObjectId } from "mongodb";
import { NotificationModule, PushNotification } from "../entity/PushNotifications";
import { AppDataSource } from "../data-source";
import { InsertPushNotificationDto } from "../dto/mobile/InsertPushNotification.dto";

const FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects/ctn-business-forum/messages:send";
const serviceAccountPath = path.join(__dirname, "../views", "google-firebase.json");

// Load service account explicitly to ensure it's valid
let serviceAccount: any;
try {
  serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  console.log("✅ FCM Service Account loaded:", serviceAccount.client_email);
} catch (error) {
  console.error("❌ Failed to load FCM service account:", error);
}

// Initialize JWT client for Firebase
const client = new JWT({
  email: serviceAccount?.client_email,
  key: serviceAccount?.private_key,
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

export async function sendPushNotification(token: string, title: string, input: any) {
  if (!token || typeof token !== "string") {
    console.error("Invalid or empty token.");
    return false;
  }

  try {
    const { token: accessToken } = await client.getAccessToken();

    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    console.log(`Sending notification to token: ${token}`, title, input);

    const message = {
      message: {
        token,
        notification: {
          title,
          body: input.content ?? "",
        },
        data: {
          moduleName: input.moduleName ?? "",
          moduleId: input.moduleId ?? ""
        },
      },
    };

    const response = await axios.post(FCM_ENDPOINT, message, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`Notification sent successfully to token [${token}]:`, response.data);

    return response.data;

  } catch (error: any) {
    console.error("Error sending notification:", error?.response?.data ?? error.message);
    return false;
  }
}
export async function insertPushNotification(
  dto: InsertPushNotificationDto
) {
  try {
    const notificationRepo = AppDataSource.getMongoRepository(PushNotification);

    const {
      token,
      subject,
      moduleId,
      moduleName,
      content,
      receiverId,
      senderId,
    } = dto;

    const notification = new PushNotification();

    notification.sub = subject ?? "";
    notification.msg = content ?? "";
    notification.moduleName = moduleName as NotificationModule.REMINDER;

    if (moduleId)
      notification.moduleId = new ObjectId(moduleId);

    notification.receiverId = new ObjectId(receiverId);

    if (senderId)
      notification.senderId = new ObjectId(senderId);
    notification.isDeleted = false;
    notification.isRead = false;
    const notificationData = await notificationRepo.save(notification);
    if (notificationData) {
      const contentObj = {
        content,
        moduleName,
        moduleId,
      };

      await sendPushNotification(
        token,
        subject,
        contentObj
      );

      return true;
    }

    return false;

  } catch (error: any) {
    console.error(
      "Error sending notification:",
      error?.response?.data ?? error.message
    );

    return false;
  }
}
