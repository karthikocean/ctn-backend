import axios from "axios";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const SMS_URL = process.env.SMS_GATEWAY_URL || "https://cpaaslink.com/api/sms/public/apikey";

/**
 * Redacts sensitive credentials from log strings/messages
 */
export function sanitizeSmsLogMessage(message: string, apiKey?: string): string {
  if (!apiKey || !message) return message;
  return message.split(apiKey).join("[REDACTED_API_KEY]");
}

/**
 * Extracts a safe error description from an Axios error without dumping config/params
 */
export function getSafeSmsErrorMessage(error: any, apiKey?: string): string {
  if (!error) return "Unknown SMS error";
  const rawMsg = error.response?.data?.message || error.message || String(error);
  return sanitizeSmsLogMessage(rawMsg, apiKey);
}

export const sendOTPSMS = async (phoneNumber: string, otp: string, name: string = "customer"): Promise<any> => {
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID;
  const welcomeTemplateId = process.env.SMS_WELCOME_TEMPLATE_ID;

  try {
    if (!apiKey || !senderId || !welcomeTemplateId) {
      console.error("[SMS Service] Configuration missing in environment variables (SMS_API_KEY, SMS_SENDER_ID, or SMS_WELCOME_TEMPLATE_ID)");
      return null;
    }

    const recipientName = name || "customer";

    const params = {
      apikey: apiKey,
      senderid: senderId,
      templateid: welcomeTemplateId,
      number: phoneNumber,
      message: `Dear ${recipientName}, Your Password Reset OTP code: ${otp} This code is valid for 5 minutes. Please do not share your OTP with anyone. Textspeed Team.`,
    };

    let response;
    try {
      response = await axios.get(SMS_URL, { params, timeout: 10000 });
    } catch {
      response = await axios.post(SMS_URL, {}, { params, timeout: 10000 });
    }

    console.log("[SMS Service] OTP SMS dispatched successfully", response.data);
    return response.data;
  } catch (error: any) {
    const safeError = getSafeSmsErrorMessage(error, apiKey);
    console.error(`[SMS Service] Error sending OTP SMS: ${safeError}`);
    return null;
  }
};

export const sendForgotPinSMS = async (phoneNumber: string, otp: string, name: string = "customer"): Promise<any> => {
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID;
  const forgotPinTemplateId = process.env.SMS_FORGOT_PIN_TEMPLATE_ID;

  try {
    if (!apiKey || !senderId || !forgotPinTemplateId) {
      console.error("[SMS Service] Forgot PIN SMS configuration missing in environment variables");
      return null;
    }

    const recipientName = name || "customer";

    const params = {
      apikey: apiKey,
      senderid: senderId,
      templateid: forgotPinTemplateId,
      number: phoneNumber,
      message: `Dear ${recipientName}, Your Password Reset OTP code: ${otp} This code is valid for 5 minutes. Please do not share your OTP with anyone. Textspeed Team.`,
    };

    let response;
    try {
      response = await axios.get(SMS_URL, { params, timeout: 10000 });
    } catch {
      response = await axios.post(SMS_URL, {}, { params, timeout: 10000 });
    }

    console.log("[SMS Service] Forgot PIN SMS dispatched successfully", response.data);
    return response.data;
  } catch (error: any) {
    const safeError = getSafeSmsErrorMessage(error, apiKey);
    console.error(`[SMS Service] Error sending Forgot PIN SMS: ${safeError}`);
    return null;
  }
};
