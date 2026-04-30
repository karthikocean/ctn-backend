import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

export class MailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
  });

  /**
     * Send a generic email
     */
  static async sendEmail(to: string | string[], subject: string, html: string) {
    try {
      const info = await this.transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || "HR Management"}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
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
}
