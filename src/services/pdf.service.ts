import PDFDocument from "pdfkit";

export class MemberPdfService {
  /**
   * Generate a professional Member Profile PDF Buffer
   */
  static async generateMemberPdf(member: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 40,
          info: {
            Title: `${member.fullName || "Member"} - Profile`,
            Author: "CTN Network Admin",
            Subject: "Member Directory Profile",
          }
        });

        const buffers: Buffer[] = [];
        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });
        doc.on("error", (err) => reject(err));

        const primaryColor = "#0F172A";
        const accentColor = "#2563EB";
        const textColor = "#334155";
        const mutedColor = "#64748B";
        const borderColor = "#E2E8F0";

        // Top Header Banner
        doc.rect(40, 40, 515, 65).fill("#0F172A");
        
        doc.fillColor("#FFFFFF")
           .fontSize(20)
           .font("Helvetica-Bold")
           .text("CTN BUSINESS NETWORK", 55, 55);

        doc.fillColor("#94A3B8")
           .fontSize(10)
           .font("Helvetica")
           .text("VERIFIED MEMBER PROFILE DOCUMENT", 55, 80);

        doc.fillColor("#38BDF8")
           .fontSize(9)
           .font("Helvetica-Bold")
           .text(`STATUS: ${(member.status || "ACTIVE").toUpperCase()}`, 400, 58, { align: "right", width: 140 });

        let currentY = 125;

        // Member Name Title
        doc.fillColor(primaryColor)
           .fontSize(18)
           .font("Helvetica-Bold")
           .text(member.fullName || "N/A", 40, currentY);

        currentY += 24;

        if (member.businessName) {
          doc.fillColor(accentColor)
             .fontSize(13)
             .font("Helvetica-Bold")
             .text(member.businessName, 40, currentY);
          currentY += 20;
        }

        // Horizontal Line
        doc.strokeColor(borderColor).lineWidth(1).moveTo(40, currentY).lineTo(555, currentY).stroke();
        currentY += 15;

        // Helper to draw section header
        const drawSectionHeader = (title: string, y: number) => {
          doc.rect(40, y, 515, 22).fill("#F8FAFC");
          doc.rect(40, y, 4, 22).fill(accentColor);
          doc.fillColor(primaryColor)
             .fontSize(11)
             .font("Helvetica-Bold")
             .text(title.toUpperCase(), 52, y + 6);
          return y + 30;
        };

        // Helper to draw two-column key-value rows
        const drawRow = (label1: string, val1: string, label2: string, val2: string, y: number) => {
          doc.fillColor(mutedColor).fontSize(9).font("Helvetica-Bold").text(label1, 40, y);
          doc.fillColor(textColor).fontSize(10).font("Helvetica").text(val1 || "-", 40, y + 12, { width: 240 });

          if (label2) {
            doc.fillColor(mutedColor).fontSize(9).font("Helvetica-Bold").text(label2, 300, y);
            doc.fillColor(textColor).fontSize(10).font("Helvetica").text(val2 || "-", 300, y + 12, { width: 240 });
          }
          return y + 32;
        };

        // Section 1: Contact Details
        currentY = drawSectionHeader("Contact Information", currentY);
        currentY = drawRow("Mobile Number", member.mobileNumber ? `+91 ${member.mobileNumber}` : "-", "Email Address", member.email || "-", currentY);
        currentY = drawRow("Date of Birth", member.dob ? new Date(member.dob).toLocaleDateString("en-GB") : "-", "Company Size", member.companySize || "-", currentY);

        currentY += 5;

        // Section 2: Business & Category Details
        currentY = drawSectionHeader("Business Details", currentY);
        const categoryName = typeof member.businessCategory === "object" ? member.businessCategory?.name : (member.businessCategory || "-");
        const subCategoryName = typeof member.subCategory === "object" ? member.subCategory?.name : (member.subCategory || "-");
        currentY = drawRow("Business Category", categoryName, "Sub Category", subCategoryName, currentY);
        currentY = drawRow("GST Number", member.gstNumber || "-", "Legal Entity Name", member.legalName || "-", currentY);
        currentY = drawRow("Experience", member.yearsOfExperience ? `${member.yearsOfExperience} Years` : "-", "Business Type", member.businessType || "-", currentY);

        currentY += 5;

        // Section 3: Location Details
        currentY = drawSectionHeader("Location Details", currentY);
        const regionName = typeof member.businessRegion === "object" ? member.businessRegion?.name : (member.businessRegion || "-");
        currentY = drawRow("City & State", `${member.city || "-"}, ${member.state || "-"}`, "Business Region", regionName, currentY);
        if (member.businessAddress) {
          doc.fillColor(mutedColor).fontSize(9).font("Helvetica-Bold").text("Business Address", 40, currentY);
          doc.fillColor(textColor).fontSize(9).font("Helvetica").text(member.businessAddress, 40, currentY + 12, { width: 500 });
          currentY += 30;
        }

        currentY += 5;

        // Section 4: Products & Services Description
        if (member.productsServicesDescription || member.about) {
          currentY = drawSectionHeader("Products & Services / About", currentY);
          const desc = member.productsServicesDescription || member.about || "";
          doc.fillColor(textColor)
             .fontSize(9.5)
             .font("Helvetica")
             .text(desc, 40, currentY, { width: 515, lineGap: 3 });
          currentY += doc.heightOfString(desc, { width: 515 }) + 15;
        }

        // Footer
        const footerY = 780;
        doc.strokeColor(borderColor).lineWidth(1).moveTo(40, footerY).lineTo(555, footerY).stroke();
        doc.fillColor(mutedColor)
           .fontSize(8)
           .font("Helvetica")
           .text(`Generated on ${new Date().toLocaleDateString("en-IN")} • Official CTN Network Document`, 40, footerY + 8, { align: "center", width: 515 });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
