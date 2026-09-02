import PDFDocument from "pdfkit";
import { Payment } from "../entity/Payment";
import { Member } from "../entity/Member";
import { Plan } from "../entity/Plan";
import fs from "fs";
import path from "path";

export class InvoiceService {
  /**
   * Generates a pixel-perfect dynamic PDF invoice matching the Ocean Softwares template.
   */
  async generateInvoicePdf(payment: Payment, member: Member, plan?: Plan | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 40,
          info: {
            Title: `Invoice #${payment.transactionId || payment._id.toString()}`,
            Author: "Ocean Softwares",
            Subject: "Tax Invoice"
          }
        });

        const buffers: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => buffers.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", (err: Error) => reject(err));

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const margin = 40;
        const tableWidth = 515; // Clean integer width matching A4 printable area

        // ==========================================
        // 1. Watermark Background
        // ==========================================
        doc.save();
        doc.rotate(-30, { origin: [pageWidth / 2, pageHeight / 2] });
        doc.fontSize(60).fillColor("#94a3b8").fillOpacity(0.04);
        doc.font("Helvetica-Bold").text("Ocean Softwares", pageWidth / 2 - 250, pageHeight / 2 - 50, { align: "center", width: 500 });
        doc.restore();
        doc.fillOpacity(1);

        // ==========================================
        // 2. Header Logo & Invoice Title
        // ==========================================
        const logoPath = path.join(process.cwd(), "public", "general", "ocean_softwares_logo.png");
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, margin, 35, { width: 175 });
        } else {
          // Fallback vector drawing if image file not on disk
          doc.circle(margin + 20, 52, 18).fill("#d81b60");
          doc.fillColor("#ffffff").fontSize(16).font("Helvetica-Bold").text("OS", margin + 8, 44);
          doc.font("Helvetica-Bold").fontSize(18).fillColor("#d81b60").text("OCEAN ", margin + 46, 38, { continued: true });
          doc.fillColor("#1e293b").text("SOFTWARES");
          doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Technology for Innovators Dreams", margin + 46, 58);
        }

        // Right-aligned Invoice Title & Number
        const invoiceNum = `OSINV-${payment._id.toString().slice(-6).toUpperCase()}`;
        doc.font("Helvetica-Bold").fontSize(18).fillColor("#1e293b");
        doc.text("Invoice", pageWidth - margin - 220, 38, { align: "right", width: 220 });

        doc.font("Helvetica-Bold").fontSize(11).fillColor("#334155");
        doc.text(`# ${invoiceNum}`, pageWidth - margin - 220, 60, { align: "right", width: 220 });

        // ==========================================
        // 3. "From:" and "Billed to:" Details
        // ==========================================
        const fromX = margin;
        const billedX = margin + tableWidth / 2 + 15;
        const addrY = 105;

        // "From:" Section
        doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("From:", fromX, addrY);
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text("Ocean Softwares", fromX, addrY + 14);
        doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
        doc.text("S. Karthikeyan", fromX, addrY + 28);
        doc.text("Plot No 7, 2nd Floor, 100 feet Main Road,", fromX, addrY + 40);
        doc.text("Tambaram, Chennai - 600073.", fromX, addrY + 52);
        doc.text("GST: 33CTGPK2283Q1Z7", fromX, addrY + 64);
        doc.text("admin@oceansoftwares.com", fromX, addrY + 76);
        doc.text("https://www.oceansoftwares.com", fromX, addrY + 88);

        // "Billed to:" Section
        const customerCompany = member.businessName || member.legalName || member.fullName || "Valued Customer";
        const customerContact = member.fullName || "";
        const customerAddress = member.businessAddress || (member.city ? `${member.city}, ${member.state || ""}, India` : "Tamil Nadu, India");
        const customerPhone = member.mobileNumber || "";
        const customerEmail = member.email || "";
        const customerGst = member.gstNumber || "N/A";

        doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("Billed to:", billedX, addrY);
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text(customerCompany, billedX, addrY + 14);
        doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
        doc.text(customerContact, billedX, addrY + 28);
        doc.text(`Address: ${customerAddress}`, billedX, addrY + 40, { width: 230 });

        const phoneY = addrY + 68;
        doc.text(`Tel: ${customerPhone}`, billedX, phoneY);
        doc.text(`Email: ${customerEmail}`, billedX, phoneY + 12);
        doc.text(`GST: ${customerGst}`, billedX, phoneY + 24);

        // Date (Above table)
        const paymentDate = payment.createdAt ? new Date(payment.createdAt) : new Date();
        const dateStr = `${String(paymentDate.getDate()).padStart(2, "0")}-${String(paymentDate.getMonth() + 1).padStart(2, "0")}-${paymentDate.getFullYear()}`;

        const dateY = addrY + 132;
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a").text(`Date: ${dateStr}`, fromX, dateY);

        // ==========================================
        // 4. Grid Table with Exact Border Alignment
        // ==========================================
        const tableTop = dateY + 16;
        // Total = 28 + 175 + 48 + 48 + 68 + 68 + 80 = 515
        const colWidths = [28, 175, 48, 48, 68, 68, 80];
        const colHeaders = ["No.", "Description", "Tax", "Quantity", "Unit Price", "Tax Value", "Subtotal"];
        const colAligns: ("left" | "center" | "right")[] = ["center", "left", "center", "center", "right", "right", "right"];

        const headerH = 22;

        // Draw Table Header Background & Grid Borders
        doc.rect(margin, tableTop, tableWidth, headerH).fillAndStroke("#ffffff", "#d1d5db");

        let currentX = margin;
        colWidths.forEach((w, i) => {
          if (i > 0) {
            // Vertical header divider
            doc.moveTo(currentX, tableTop).lineTo(currentX, tableTop + headerH).strokeColor("#d1d5db").lineWidth(0.6).stroke();
          }

          doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a");
          const pad = 4;
          const align = colAligns[i];
          const textX = currentX + pad;
          const textW = w - pad * 2;
          doc.text(colHeaders[i], textX, tableTop + 6, { width: textW, align });

          currentX += w;
        });

        // Calculate Row Values
        const isPaid = payment.status === "COMPLETED";
        const totalAmount = payment.amount || 0;
        const unitPrice = Math.round((totalAmount / 1.18) * 100) / 100;
        const totalTax = Math.round((totalAmount - unitPrice) * 100) / 100;
        const halfTax = Math.round((totalTax / 2) * 100) / 100;
        const subtotal = unitPrice;

        const planTitle = plan?.title || "Membership Plan";
        const cycle = plan?.billingCycle || "yearly";
        const descText = `CTN Subscription -\n${planTitle} (${cycle})\n(Txn: ${payment.transactionId || "N/A"})`;

        const rowY = tableTop + headerH;
        const rowH = 46;

        // Draw Row Box
        doc.rect(margin, rowY, tableWidth, rowH).strokeColor("#d1d5db").lineWidth(0.6).stroke();

        const rowData = [
          "1",
          descText,
          "18.00%",
          "1",
          unitPrice.toFixed(2),
          totalTax.toFixed(2),
          subtotal.toFixed(2)
        ];

        currentX = margin;
        colWidths.forEach((w, i) => {
          if (i > 0) {
            // Vertical row divider
            doc.moveTo(currentX, rowY).lineTo(currentX, rowY + rowH).strokeColor("#d1d5db").lineWidth(0.6).stroke();
          }

          doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
          const pad = 4;
          const align = colAligns[i];
          const textX = currentX + pad;
          const textW = w - pad * 2;
          doc.text(rowData[i], textX, rowY + 6, { width: textW, align });

          currentX += w;
        });

        // ==========================================
        // 5. Summary Totals Grid Table (Aligned with Columns 4, 5, 6)
        // ==========================================
        const summaryStartY = rowY + rowH;
        // Col 4 (68) + Col 5 (68) = 136 (Label column)
        const summaryLabelW = 68 + 68; // 136
        // Col 6 = 80 (Value column)
        const summaryValW = 80;
        const summaryTotalW = summaryLabelW + summaryValW; // 216
        // Starts exactly where Col 4 begins: margin + 28 + 175 + 48 + 48 = margin + 299
        const summaryX = margin + 28 + 175 + 48 + 48; // margin + 299
        const summaryRowH = 18;

        const summaryRows = [
          { label: "Total (INR)", val: subtotal.toFixed(2), bold: true },
          { label: "SGST (9%)", val: halfTax.toFixed(2), bold: false },
          { label: "CGST (9%)", val: halfTax.toFixed(2), bold: false },
          { label: "Grand Total (INR)", val: totalAmount.toFixed(2), bold: true, highlight: true },
          { label: "Paid (INR)", val: (isPaid ? totalAmount : 0).toFixed(2), bold: true },
          { label: "Balance (INR)", val: (isPaid ? 0 : totalAmount).toFixed(2), bold: true }
        ];

        let currSumY = summaryStartY;
        summaryRows.forEach((s) => {
          if (s.highlight) {
            doc.save();
            doc.rect(summaryX, currSumY, summaryTotalW, summaryRowH).fill("#f1f5f9");
            doc.restore();
          }

          // Full cell borders aligned with main table right edge & column dividers
          doc.rect(summaryX, currSumY, summaryTotalW, summaryRowH).strokeColor("#d1d5db").lineWidth(0.6).stroke();
          doc.moveTo(summaryX + summaryLabelW, currSumY).lineTo(summaryX + summaryLabelW, currSumY + summaryRowH).strokeColor("#d1d5db").lineWidth(0.6).stroke();

          doc.font(s.bold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(8.5)
            .fillColor(s.highlight ? "#0f172a" : "#334155");

          doc.text(s.label, summaryX + 6, currSumY + 4, { width: summaryLabelW - 12, align: "right" });
          doc.text(s.val, summaryX + summaryLabelW + 4, currSumY + 4, { width: summaryValW - 8, align: "right" });

          currSumY += summaryRowH;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
