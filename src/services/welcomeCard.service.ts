import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
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
   * Generates the pixel-perfect New Member Welcome Card PDF buffer matching the official TN flyer design
   */
  static async generateWelcomeCardPdf(member: Member): Promise<Buffer> {
    // 1. Resolve Category and SubCategory names if available
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

    return new Promise((resolve, reject) => {
      try {
        const pageWidth = 360;
        const pageHeight = 586;

        const doc = new PDFDocument({
          size: [pageWidth, pageHeight],
          margin: 0,
          info: {
            Title: `Welcome - ${member.fullName || "New Member"}`,
            Author: "Trusted Network",
            Subject: "New Member Welcome Announcement"
          }
        });

        const buffers: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => buffers.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", (err: Error) => reject(err));

        const fontPath = this.findFontPath();
        if (fontPath) {
          doc.registerFont("GreatVibes", fontPath);
        }

        const navyDark = "#06152D";
        const navyCard = "#081E3D";
        const goldAccent = "#DCA838";
        const goldLight = "#FEF3C7";
        const goldBorder = "#F59E0B";
        const goldText = "#92400E";
        const slateDark = "#1E293B";
        const slateMuted = "#64748B";

        // 1. Overall Background: Pure White
        doc.rect(0, 0, pageWidth, pageHeight).fill("#FFFFFF");

        // Outer Card Frame with smooth rounded corners
        doc.roundedRect(3, 3, pageWidth - 6, pageHeight - 6, 22)
           .lineWidth(1.5)
           .strokeColor("#E2E8F0")
           .stroke();

        // Top corner decorative navy accents with gold trim
        // Top Left Corner
        doc.save();
        doc.moveTo(3, 3)
           .lineTo(85, 3)
           .bezierCurveTo(65, 3, 3, 65, 3, 85)
           .closePath()
           .fill(navyDark);
        doc.moveTo(85, 3)
           .bezierCurveTo(65, 3, 3, 65, 3, 85)
           .lineWidth(3)
           .strokeColor(goldAccent)
           .stroke();
        doc.restore();

        // Top Right Corner
        doc.save();
        doc.moveTo(pageWidth - 3, 3)
           .lineTo(pageWidth - 85, 3)
           .bezierCurveTo(pageWidth - 65, 3, pageWidth - 3, 65, pageWidth - 3, 85)
           .closePath()
           .fill(navyDark);
        doc.moveTo(pageWidth - 85, 3)
           .bezierCurveTo(pageWidth - 65, 3, pageWidth - 3, 65, pageWidth - 3, 85)
           .lineWidth(3)
           .strokeColor(goldAccent)
           .stroke();
        doc.restore();

        // 2. Top Header Logo
        const logoPath = this.findLogoPath();
        if (logoPath) {
          const logoWidth = 175;
          const logoX = (pageWidth - logoWidth) / 2;
          doc.image(logoPath, logoX, 22, { width: logoWidth });
        }

        // 3. Main Navy Blue Container
        const mainContainerY = 82;
        const mainContainerHeight = 454;
        const mainContainerWidth = pageWidth - 28; // 332
        const mainContainerX = 14;

        // Dark Navy Background
        doc.roundedRect(mainContainerX, mainContainerY, mainContainerWidth, mainContainerHeight, 20)
           .fill(navyCard);

        // Gold border on main container
        doc.save();
        doc.roundedRect(mainContainerX, mainContainerY, mainContainerWidth, mainContainerHeight, 20)
           .lineWidth(1.2)
           .strokeColor(goldAccent)
           .stroke();
        doc.restore();

        // 4. "Welcome!" script title
        if (fontPath) {
          doc.font("GreatVibes").fontSize(44).fillColor(goldAccent);
        } else {
          doc.font("Times-Italic").fontSize(40).fillColor(goldAccent);
        }
        doc.text("Welcome!", 0, 108, { align: "center", width: pageWidth });

        // 5. "NEW MEMBER JOINED"
        doc.font("Helvetica-Bold")
           .fontSize(16)
           .fillColor("#FFFFFF")
           .text("NEW MEMBER JOINED", 0, 162, { align: "center", width: pageWidth, characterSpacing: 1.2 });

        // 6. Gold divider line with user icon below title
        const dividerY = 192;
        doc.save();
        doc.strokeColor(goldAccent).lineWidth(1);
        // Left line
        doc.moveTo(115, dividerY).lineTo(162, dividerY).stroke();
        // Right line
        doc.moveTo(198, dividerY).lineTo(245, dividerY).stroke();

        // Small user icon in center
        doc.circle(180, dividerY - 4, 3).stroke();
        (doc as any).arc(180, dividerY + 5, 5.5, Math.PI, 2 * Math.PI).stroke();
        doc.circle(184, dividerY + 4, 1.8).fillAndStroke(goldAccent, goldAccent);
        doc.restore();

        // 7. Center White Profile Card
        const cardX = 30;
        const cardY = 212;
        const cardWidth = pageWidth - 60; // 300
        const cardHeight = 304;

        doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 18)
           .fill("#FFFFFF");

        // 8. Avatar / Initial Circle
        const avatarCenterX = pageWidth / 2;
        const avatarCenterY = cardY + 52;
        const avatarRadius = 36;

        // Outer Gold Ring
        doc.circle(avatarCenterX, avatarCenterY, avatarRadius + 2.5)
           .lineWidth(2.5)
           .strokeColor(goldAccent)
           .stroke();

        // Inner Navy Fill
        doc.circle(avatarCenterX, avatarCenterY, avatarRadius)
           .fill(navyDark);

        // Initial Letter (e.g. "A")
        const initial = (member.fullName ? member.fullName.trim().charAt(0) : "M").toUpperCase();
        doc.font("Helvetica-Bold")
           .fontSize(34)
           .fillColor("#FFFFFF")
           .text(initial, avatarCenterX - 25, avatarCenterY - 17, { align: "center", width: 50 });

        // 9. Member Full Name
        const nameY = cardY + 104;
        doc.font("Helvetica-Bold")
           .fontSize(18)
           .fillColor(navyDark)
           .text(member.fullName || "Valued Member", cardX + 15, nameY, {
             align: "center",
             width: cardWidth - 30
           });

        const nameHeight = doc.heightOfString(member.fullName || "Valued Member", { width: cardWidth - 30 });
        const businessY = nameY + Math.max(24, nameHeight + 6);

        // 10. Business Name
        doc.font("Helvetica-Bold")
           .fontSize(12)
           .fillColor(slateDark)
           .text(member.businessName || "Business Network Member", cardX + 15, businessY, {
             align: "center",
             width: cardWidth - 30
           });

        const businessHeight = doc.heightOfString(member.businessName || "Business Network Member", { width: cardWidth - 30 });
        const catY = businessY + Math.max(18, businessHeight + 5);

        // 11. Categories / Subcategories Line
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

        doc.font("Helvetica")
           .fontSize(9)
           .fillColor(slateMuted)
           .text(categoriesText, cardX + 15, catY, {
             align: "center",
             width: cardWidth - 30,
             lineGap: 3
           });

        const catHeight = doc.heightOfString(categoriesText, { width: cardWidth - 30, lineGap: 3 });

        // 12. "NEW MEMBER" Badge
        const badgeWidth = 144;
        const badgeHeight = 28;
        const badgeX = (pageWidth - badgeWidth) / 2;
        const badgeY = catY + Math.max(24, catHeight + 8);

        doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 8)
           .fillAndStroke(goldLight, goldBorder);

        // Icon + text inside badge
        doc.save();
        doc.strokeColor(goldText).lineWidth(1.2);
        const iconX = badgeX + 20;
        const iconY = badgeY + 14;
        doc.circle(iconX, iconY - 3, 2.5).stroke();
        (doc as any).arc(iconX, iconY + 5, 4.5, Math.PI, 2 * Math.PI).stroke();
        doc.moveTo(iconX + 7, iconY - 2).lineTo(iconX + 7, iconY + 4).stroke();
        doc.moveTo(iconX + 4, iconY + 1).lineTo(iconX + 10, iconY + 1).stroke();
        doc.restore();

        doc.font("Helvetica-Bold")
           .fontSize(10.5)
           .fillColor(goldText)
           .text("NEW MEMBER", badgeX + 36, badgeY + 8);

        // 13. Horizontal divider line with gold dot
        const divider2Y = badgeY + 38;
        doc.save();
        doc.strokeColor("#FDE68A").lineWidth(0.8);
        doc.moveTo(cardX + 20, divider2Y).lineTo(cardX + cardWidth - 20, divider2Y).stroke();
        doc.circle(pageWidth / 2, divider2Y, 2.2).fill(goldAccent);
        doc.restore();

        // 14. Welcome Community Text (Exact 3-line layout matching reference flyer)
        const welcomeTextY = divider2Y + 14;
        const welcomeText = "Let's give a warm welcome to our newest\nmember in the Trusted Network\ncommunity!";
        doc.font("Helvetica")
           .fontSize(9.5)
           .fillColor("#334155")
           .text(
             welcomeText,
             cardX + 15,
             welcomeTextY,
             {
               align: "center",
               width: cardWidth - 30,
               lineGap: 3.5
             }
           );

        // 15. Bottom Footer (Website URL + Bottom Corner Accents)
        const cornerSize = 75;
        // Bottom Left Corner
        doc.save();
        doc.moveTo(3, pageHeight - 3)
           .lineTo(cornerSize, pageHeight - 3)
           .bezierCurveTo(cornerSize - 20, pageHeight - 3, 3, pageHeight - 20, 3, pageHeight - cornerSize)
           .closePath()
           .fill(navyDark);
        doc.moveTo(cornerSize, pageHeight - 3)
           .bezierCurveTo(cornerSize - 20, pageHeight - 3, 3, pageHeight - 20, 3, pageHeight - cornerSize)
           .lineWidth(3)
           .strokeColor(goldAccent)
           .stroke();
        doc.restore();

        // Bottom Right Corner
        doc.save();
        doc.moveTo(pageWidth - 3, pageHeight - 3)
           .lineTo(pageWidth - cornerSize, pageHeight - 3)
           .bezierCurveTo(pageWidth - cornerSize + 20, pageHeight - 3, pageWidth - 3, pageHeight - 20, pageWidth - 3, pageHeight - cornerSize)
           .closePath()
           .fill(navyDark);
        doc.moveTo(pageWidth - cornerSize, pageHeight - 3)
           .bezierCurveTo(pageWidth - cornerSize + 20, pageHeight - 3, pageWidth - 3, pageHeight - 20, pageWidth - 3, pageHeight - cornerSize)
           .lineWidth(3)
           .strokeColor(goldAccent)
           .stroke();
        doc.restore();

        // Website URL at bottom center
        const footerY = pageHeight - 30;
        doc.save();
        const globeX = (pageWidth / 2) - 78;
        doc.circle(globeX, footerY + 5, 5).lineWidth(1).strokeColor(navyDark).stroke();
        doc.moveTo(globeX - 5, footerY + 5).lineTo(globeX + 5, footerY + 5).stroke();
        (doc as any).arc(globeX, footerY + 5, 2.5, 0, 2 * Math.PI).stroke();
        doc.restore();

        doc.font("Helvetica-Bold")
           .fontSize(9)
           .fillColor(navyDark)
           .text("www.trustednetwork.in", globeX + 12, footerY);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates the welcome PDF card and sends it via email to admin@trustednetwork.in
   */
  static async sendRegistrationWelcomeEmailToAdmin(member: Member): Promise<void> {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "admin@trustednetwork.in";

    try {
      const pdfBuffer = await this.generateWelcomeCardPdf(member);
      const safeName = (member.fullName || "New_Member").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Welcome_Card_${safeName}.pdf`;

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
              📎 <strong>Attached:</strong> The official New Member Welcome flyer PDF (<code>${filename}</code>) has been attached to this email.
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
            content: pdfBuffer,
            contentType: "application/pdf"
          }
        ]
      );

      console.log(`[WelcomeCardService] Welcome card PDF sent to ${adminEmail} for member ${member.fullName} (${member._id})`);
    } catch (error: any) {
      console.error(`[WelcomeCardService] Failed to generate/send welcome email to ${adminEmail}:`, error.message);
      // Non-blocking: registration itself will not fail if email delivery fails
    }
  }
}
