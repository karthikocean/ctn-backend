import axios from "axios";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const API_KEY = process.env.SMS_API_KEY;
const SENDER_ID = process.env.SMS_SENDER_ID;
const WELCOME_TEMPLATE_ID = process.env.SMS_WELCOME_TEMPLATE_ID;
const FORGOT_PIN_TEMPLATE_ID = process.env.SMS_FORGOT_PIN_TEMPLATE_ID;
const SMS_URL = "https://sms.textspeed.in/vb/apikey.php";

export const sendOTPSMS = async (phoneNumber: string, otp: string) => {
  try {
    if (!API_KEY || !SENDER_ID || !WELCOME_TEMPLATE_ID) {
      console.error("SMS configuration missing in environment variables");
      return null;
    }

    const response = await axios.post(
      SMS_URL,
      {}, // empty body because API uses query params
      {
        params: {
          apikey: API_KEY,
          senderid: SENDER_ID,
          templateid: WELCOME_TEMPLATE_ID,
          number: phoneNumber,
          message: `Dear customer, the OTP For Nalsuvai Agro Foods is ${otp}. This OTP will expire in 5 minutes. Thank you.`,
        },
      }
    );

    console.log("SMS Sent:", response.data);

  } catch (error) {
    console.error("Error sending OTP SMS:", error);
    return null;
  }
};

export const sendForgotPinSMS = async (phoneNumber: string, otp: string) => {
  try {
    if (!API_KEY || !SENDER_ID || !FORGOT_PIN_TEMPLATE_ID) {
      console.error("Forgot PIN SMS configuration missing in environment variables");
      return null;
    }

    const response = await axios.post(
      SMS_URL,
      {}, // empty body because API uses query params
      {
        params: {
          apikey: API_KEY,
          senderid: SENDER_ID,
          templateid: WELCOME_TEMPLATE_ID,
          number: phoneNumber,
          message: `Dear customer, the OTP For Nalsuvai Agro Foods is ${otp}. This OTP will expire in 5 minutes. Thank you.`,
        },
      }
    );

    console.log("Forgot PIN SMS Sent:", response.data);

  } catch (error) {
    console.error("Error sending Forgot PIN SMS:", error);
    return null;
  }
};

