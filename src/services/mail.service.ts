import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

export class MailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.ZEPTO_MAIL_HOST || "smtp.zeptomail.com",
    port: parseInt(process.env.ZEPTO_MAIL_PORT || "587"),
    secure: process.env.ZEPTO_MAIL_PORT === "465",
    auth: {
      user: process.env.ZEPTO_MAIL_USER && process.env.ZEPTO_MAIL_USER !== "your_username"
        ? process.env.ZEPTO_MAIL_USER
        : "emailapikey",
      pass: process.env.ZEPTO_MAIL_PASSWORD && process.env.ZEPTO_MAIL_PASSWORD !== "your_password"
        ? process.env.ZEPTO_MAIL_PASSWORD
        : process.env.ZEPTO_MAIL_API_KEY || "",
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  /**
     * Send a generic email
     */
  static async sendEmail(to: string | string[], subject: string, html: string) {
    try {
      const info = await this.transporter.sendMail({
        from: `"${process.env.ZEPTO_MAIL_FROM_NAME || "Trusted Network"}" <${process.env.ZEPTO_MAIL_FROM_EMAIL || "noreply@trustednetwork.in"}>`,
        to: Array.isArray(to) ? to.join(",") : to,
        subject: subject,
        html: html,
      });
      console.log("Email sent: %s", info.messageId);
      return info;
    } catch (error) {
      console.error("Error sending email:", error);
      throw error;
    }
  }

  /**
     * Send Interview Schedule email to Candidate
     */
  static async sendInterviewCandidateEmail(candidateData: {
    name: string;
    email: string;
    interviewId: string;
    vacancy: string;
    date: string;
    time: string;
    platform: string;
    location?: string;
    duration: number;
  }) {
    const subject = `Interview Scheduled: ${candidateData.vacancy}`;
    const html = `
            <h3>Dear ${candidateData.name},</h3>
            <p>Your interview for the position of <strong>${candidateData.vacancy}</strong> has been scheduled.</p>
            <p><strong>Interview Details:</strong></p>
            <ul>
                <li><strong>Interview ID:</strong> ${candidateData.interviewId}</li>
                <li><strong>Date:</strong> ${candidateData.date}</li>
                <li><strong>Time:</strong> ${candidateData.time} (${candidateData.duration} minutes)</li>
                <li><strong>Platform:</strong> ${candidateData.platform}</li>
                ${candidateData.location ? `<li><strong>Link/Location:</strong> ${candidateData.location}</li>` : ""}
            </ul>
            <p>Please be available on time. Best of luck!</p>
            <p>Regards,<br>HR Recruitment Team</p>
        `;
    return this.sendEmail(candidateData.email, subject, html);
  }

  /**
     * Send Interview Schedule email to Interviewers
     */
  static async sendInterviewInterviewerEmail(email: string, data: {
    interviewerName: string;
    candidateName: string;
    vacancy: string;
    date: string;
    time: string;
    platform: string;
    location?: string;
  }) {
    const subject = `New Interview Assignment: ${data.candidateName} for ${data.vacancy}`;
    const html = `
            <h3>Dear ${data.interviewerName},</h3>
            <p>You have been assigned as a panel member for the following interview:</p>
            <p><strong>Candidate:</strong> ${data.candidateName}</p>
            <p><strong>Position:</strong> ${data.vacancy}</p>
            <p><strong>Date:</strong> ${data.date}</p>
            <p><strong>Time:</strong> ${data.time}</p>
            <p><strong>Platform:</strong> ${data.platform}</p>
            ${data.location ? `<li><strong>Link/Location:</strong> ${data.location}</li>` : ""}
            <p>Regards,<br>HR Recruitment Team</p>
        `;
    return this.sendEmail(email, subject, html);
  }

  /**
     * Send Email Verification OTP
     */
  static async sendVerificationOTP(email: string, otp: string) {
    const subject = "Verify Your Email - Trusted Network";
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px; border-radius: 10px; border: 1px solid #e0e0e0;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #14532D; margin: 0;">Trusted Network</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <h2 style="color: #333; margin-top: 0;">Email Verification</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">Hello,</p>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">Thank you for joining <strong>Trusted Network</strong>. Please use the following 4-digit verification code to complete your registration:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <div style="display: inline-block; background-color: #14532D; color: #ffffff; font-size: 32px; font-weight: bold; letter-spacing: 10px; padding: 15px 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(20, 83, 45, 0.2);">
              ${otp}
            </div>
          </div>
          
          <p style="color: #666; font-size: 14px; line-height: 1.5; text-align: center;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>&copy; 2026 Trusted Network. All rights reserved.</p>
        </div>
      </div>
    `;
    return this.sendEmail(email, subject, html);
  }

  /**
   * Send Welcome Email to New Registered Member
   */
  /**
   * Send Welcome Email with credentials to New Admin User
   */
  static async sendAdminUserWelcomeEmail(data: {
    name: string;
    email: string;
    roleName: string;
    password?: string;
  }) {
    const subject = "Your TN Admin Portal Credentials - Trusted Network";
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px; border-radius: 10px; border: 1px solid #e0e0e0;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #14532D; margin: 0;">Trusted Network</h1>
          <p style="color: #666; font-size: 14px; margin-top: 5px;">Admin Portal Access</p>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <h2 style="color: #333; margin-top: 0;">Welcome, ${data.name}! 🎉</h2>
          <p style="color: #666; font-size: 15px; line-height: 1.5;">
            An administrative account has been created for you on the <strong>TN Admin Portal</strong> with the role of <strong>${data.roleName}</strong>.
          </p>
          
          <div style="background-color: #f0fdf4; border-left: 4px solid #14532D; padding: 18px 20px; margin: 25px 0; border-radius: 6px;">
            <h3 style="color: #14532D; margin-top: 0; margin-bottom: 12px; font-size: 16px;">Your Login Credentials:</h3>
            <p style="margin: 6px 0; color: #333; font-size: 14px;"><strong>Email (Username):</strong> <span style="font-family: monospace; font-weight: bold; color: #1e293b;">${data.email}</span></p>
            <p style="margin: 6px 0; color: #333; font-size: 14px;"><strong>Temporary Password:</strong> <span style="font-family: monospace; font-weight: bold; background: #e2e8f0; padding: 3px 8px; border-radius: 4px; color: #0f172a;">${data.password || "Admin@12345"}</span></p>
            <p style="margin: 6px 0; color: #333; font-size: 14px;"><strong>Assigned Role:</strong> ${data.roleName}</p>
          </div>

          <p style="color: #666; font-size: 14px; line-height: 1.5;">
            Please log in to the admin portal using your email and the temporary password above.
          </p>
          <p style="color: #e11d48; font-size: 13px; line-height: 1.5;">
            🔒 <em>For your security, please update your password after your first login in Profile Settings.</em>
          </p>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>&copy; 2026 Trusted Network. All rights reserved.</p>
        </div>
      </div>
    `;
    return this.sendEmail(data.email, subject, html);
  }

  static async sendWelcomeMemberEmail(memberData: {
    fullName: string;
    email: string;
    mobileNumber: string;
    pin?: string;
  }) {
    const subject = "Welcome to Trusted Network!";
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px; border-radius: 10px; border: 1px solid #e0e0e0;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #14532D; margin: 0;">Trusted Network</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <h2 style="color: #333; margin-top: 0;">Welcome, ${memberData.fullName}! 🎉</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">
            Your account has been successfully created on <strong>Trusted Network</strong>. We're excited to have you as part of our business community!
          </p>
          
          <div style="background-color: #f0fdf4; border-left: 4px solid #14532D; padding: 15px 20px; margin: 25px 0; border-radius: 4px;">
            <h3 style="color: #14532D; margin-top: 0; margin-bottom: 10px; font-size: 16px;">Your Login Credentials:</h3>
            <p style="margin: 5px 0; color: #333; font-size: 15px;"><strong>Mobile Number:</strong> ${memberData.mobileNumber}</p>
            <p style="margin: 5px 0; color: #333; font-size: 15px;"><strong>Email:</strong> ${memberData.email}</p>
            ${memberData.pin ? `<p style="margin: 5px 0; color: #333; font-size: 15px;"><strong>Default PIN:</strong> <span style="font-weight: bold; background: #e2e8f0; padding: 2px 8px; border-radius: 4px; letter-spacing: 1px;">${memberData.pin}</span></p>` : ""}
          </div>

          <p style="color: #666; font-size: 14px; line-height: 1.5;">
            You can now log in to the <strong>Trusted Network</strong> mobile app using your registered mobile number and the default PIN provided above.
          </p>
          <p style="color: #e11d48; font-size: 13px; line-height: 1.5;">
            🔒 <em>For your security, please update your PIN immediately upon your first login.</em>
          </p>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>&copy; 2026 Trusted Network. All rights reserved.</p>
        </div>
      </div>
    `;
    return this.sendEmail(memberData.email, subject, html);
  }
}
