import fs from "fs";
import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer-core";
import { Member } from "../entity/Member";
import { Category } from "../entity/Category";
import { AppDataSource } from "../data-source";
import { MailService } from "./mail.service";
import { ObjectId } from "mongodb";

export class WelcomeCardService {
  private static get categoryRepo() {
    return AppDataSource.getMongoRepository(Category);
  }

  /**
   * Resolves the Trusted Network logo path across dev and compiled production environments
   */
  private static findLogoPath(): string | null {
    const candidateLogoPaths = [
      path.join(__dirname, "..", "views", "TN logo.png"),
      path.join(__dirname, "..", "..", "src", "views", "TN logo.png"),
      path.join(process.cwd(), "src", "views", "TN logo.png"),
      path.join(process.cwd(), "views", "TN logo.png"),
      path.join(process.cwd(), "dist", "views", "TN logo.png"),
      path.join(process.cwd(), "public", "general", "TN logo.png")
    ];

    for (const p of candidateLogoPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Resolves the Great Vibes cursive font path across dev and compiled production environments
   */
  private static findFontPath(): string | null {
    const candidateFontPaths = [
      path.join(__dirname, "..", "views", "fonts", "GreatVibes-Regular.ttf"),
      path.join(__dirname, "..", "..", "src", "views", "fonts", "GreatVibes-Regular.ttf"),
      path.join(process.cwd(), "src", "views", "fonts", "GreatVibes-Regular.ttf"),
      path.join(process.cwd(), "dist", "views", "fonts", "GreatVibes-Regular.ttf"),
      path.join(process.cwd(), "public", "general", "fonts", "GreatVibes-Regular.ttf")
    ];

    for (const p of candidateFontPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Resolves the Welcome Card EJS template path across dev and compiled environments
   */
  private static findTemplatePath(): string {
    const candidateTemplatePaths = [
      path.join(__dirname, "..", "views", "welcomeCard.ejs"),
      path.join(__dirname, "..", "..", "src", "views", "welcomeCard.ejs"),
      path.join(process.cwd(), "src", "views", "welcomeCard.ejs"),
      path.join(process.cwd(), "views", "welcomeCard.ejs"),
      path.join(process.cwd(), "dist", "views", "welcomeCard.ejs")
    ];

    for (const p of candidateTemplatePaths) {
      if (fs.existsSync(p)) return p;
    }

    throw new Error("Welcome Card EJS template not found (searched in src/views and dist/views)");
  }

  /**
   * Resolves Chromium / Chrome executable across Windows, Linux, and macOS
   */
  private static findChromiumPath(): string {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const candidatePaths = [
      // Windows Google Chrome
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      // Windows Microsoft Edge
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      // Linux Google Chrome / Chromium
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      // macOS Google Chrome / Edge
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p;
    }

    throw new Error("Chromium/Chrome executable not found. Please set PUPPETEER_EXECUTABLE_PATH or install Chrome/Chromium.");
  }

  /**
   * Resolves member category, subcategory, display text, and initials
   */
  private static async resolveMemberDetails(member: Member): Promise<{
    categoriesText: string;
    initial: string;
  }> {
    let categoryName = "";
    let subCategoryName = "";

    try {
      const catIds: ObjectId[] = [];
      if (member.businessCategory && ObjectId.isValid(member.businessCategory.toString())) {
        catIds.push(new ObjectId(member.businessCategory));
      }
      if (member.subCategory && ObjectId.isValid(member.subCategory.toString())) {
        catIds.push(new ObjectId(member.subCategory));
      }

      if (catIds.length > 0) {
        const categories = await this.categoryRepo.find({
          where: { _id: { $in: catIds } } as any
        });
        const catMap = new Map(categories.map(c => [c._id.toString(), c.name]));
        if (member.businessCategory) {
          categoryName = catMap.get(member.businessCategory.toString()) || "";
        }
        if (member.subCategory) {
          subCategoryName = catMap.get(member.subCategory.toString()) || "";
        }
      }
    } catch (e: any) {
      console.error("[WelcomeCardService] Category resolution notice:", e.message);
    }

    let categoriesText = "";
    if (categoryName && subCategoryName) {
      categoriesText = `${categoryName} • ${subCategoryName}`;
    } else if (categoryName) {
      categoriesText = categoryName;
    } else if (member.industry) {
      categoriesText = member.industry;
    }

    if (member.city) {
      categoriesText = categoriesText ? `${categoriesText} • ${member.city}` : member.city;
    }

    if (!categoriesText) {
      categoriesText = "Trusted Network Community Member";
    }

    const initial = (member.fullName ? member.fullName.trim().charAt(0) : "M").toUpperCase();

    return { categoriesText, initial };
  }

  /**
   * Generates high-quality New Member Welcome Card PNG buffer directly via EJS and Puppeteer
   */
  static async generateWelcomeCardPng(member: Member): Promise<Buffer> {
    const { categoriesText, initial } = await this.resolveMemberDetails(member);

    const logoPath = this.findLogoPath();
    const fontPath = this.findFontPath();
    const templatePath = this.findTemplatePath();
    const chromiumPath = this.findChromiumPath();

    const logoDataUri = logoPath && fs.existsSync(logoPath)
      ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
      : "";

    const fontDataUri = fontPath && fs.existsSync(fontPath)
      ? `data:font/ttf;base64,${fs.readFileSync(fontPath).toString("base64")}`
      : "";

    const html = await ejs.renderFile(templatePath, {
      member,
      initial,
      categoriesText,
      logoDataUri,
      fontDataUri
    });

    const browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none"
      ]
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({
        width: 360,
        height: 586,
        deviceScaleFactor: 2 // High-DPI 720x1172 PNG
      });

      await page.setContent(html, { waitUntil: "networkidle0" as any });

      // Wait for fonts and all images to be loaded
      await page.evaluate(`
        (async () => {
          if (document.fonts) {
            await document.fonts.ready;
          }
          const images = Array.from(document.images);
          await Promise.all(
            images.map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
              });
            })
          );
        })()
      `);

      const pngBuffer = await page.screenshot({
        type: "png",
        omitBackground: false
      });

      return Buffer.from(pngBuffer);
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /**
   * Backwards-compatible alias for generateWelcomeCardPng
   */
  static async generateWelcomeCardPdf(member: Member): Promise<Buffer> {
    return this.generateWelcomeCardPng(member);
  }

  /**
   * Generates the welcome PNG card and sends it via email to admin@trustednetwork.in
   */
  static async sendRegistrationWelcomeEmailToAdmin(member: Member): Promise<void> {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "admin@trustednetwork.in";

    try {
      const pngBuffer = await this.generateWelcomeCardPng(member);
      const safeName = (member.fullName || "New_Member").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Welcome_Card_${safeName}.png`;

      const subject = `🎉 New Member Registered: ${member.fullName || "New Member"} - Trusted Network`;

      const html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #06152D; margin: 0; font-size: 24px;">Trusted Network</h1>
            <p style="color: #64748B; font-size: 14px; margin-top: 6px;">New Member Registration Notification</p>
          </div>
          <div style="background-color: #ffffff; padding: 28px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.04); border: 1px solid #edf2f7;">
            <h2 style="color: #081E3D; margin-top: 0; font-size: 20px;">A New Member Has Joined! 🎉</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6;">
              A new member has completed registration on <strong>Trusted Network</strong>. Please find the details and attached official Welcome Card below.
            </p>

            <div style="background-color: #f8fafc; border-left: 4px solid #DCA838; padding: 18px 20px; margin: 24px 0; border-radius: 6px;">
              <h3 style="color: #081E3D; margin-top: 0; margin-bottom: 14px; font-size: 16px;">Member Information:</h3>
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748B; width: 140px;"><strong>Full Name:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A; font-weight: 600;">${member.fullName || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B;"><strong>Business Name:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A;">${member.businessName || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B;"><strong>Mobile Number:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A;">+91 ${member.mobileNumber || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B;"><strong>Email:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A;">${member.email || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B;"><strong>City / State:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A;">${[member.city, member.state].filter(Boolean).join(", ") || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B;"><strong>Referral Code:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A;"><span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${member.referralCode || "-"}</span></td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B;"><strong>Joined At:</strong></td>
                  <td style="padding: 6px 0; color: #0F172A;">${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</td>
                </tr>
              </table>
            </div>

            <p style="color: #475569; font-size: 14px; line-height: 1.5;">
              📎 <strong>Attached:</strong> The official New Member Welcome flyer image (<code>${filename}</code>) has been attached to this email.
            </p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #94A3B8; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Trusted Network. All rights reserved.</p>
          </div>
        </div>
      `;

      await MailService.sendEmail(
        adminEmail,
        subject,
        html,
        [
          {
            filename,
            content: pngBuffer,
            contentType: "image/png"
          }
        ]
      );

      console.log(`[WelcomeCardService] Welcome card PNG sent to ${adminEmail} for member ${member.fullName} (${member._id})`);
    } catch (error: any) {
      console.error(`[WelcomeCardService] Failed to generate/send welcome email to ${adminEmail}:`, error.message);
      // Non-blocking: registration itself will not fail if email delivery fails
    }
  }
}
