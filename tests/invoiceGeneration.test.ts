/**
 * Tests for Dynamic Invoice PDF Generation (Mobile & Admin APIs)
 */

import { ObjectId } from "mongodb";
import { InvoiceService } from "../src/services/invoice.service";
import { Payment } from "../src/entity/Payment";
import { Member } from "../src/entity/Member";
import { Plan } from "../src/entity/Plan";

describe("Invoice PDF Generation Service", () => {
  const invoiceService = new InvoiceService();

  test("1. generateInvoicePdf produces a valid PDF buffer with PDF headers", async () => {
    const payment = new Payment();
    payment._id = new ObjectId("6a8008399f722978fdf51625");
    payment.memberId = new ObjectId();
    payment.planId = new ObjectId();
    payment.amount = 9999;
    payment.status = "COMPLETED";
    payment.paymentMethod = "razorpay";
    payment.transactionId = "pay_OSINV1490628";
    payment.createdAt = new Date("2026-08-19");

    const member = new Member();
    member._id = payment.memberId;
    member.fullName = "Mr. Elangovan";
    member.businessName = "Shree Varu Homes";
    member.businessAddress = "No.15 C V Raman Road, Alwarpet";
    member.city = "Chennai";
    member.state = "TamilNadu";
    member.mobileNumber = "9841070017";
    member.email = "shreevaruhomes@gmail.com";
    member.gstNumber = "33AAFPI3050H1Z7";

    const plan = new Plan();
    plan._id = payment.planId;
    plan.title = "Advance Plan";
    plan.billingCycle = "yearly";
    plan.amount = 9999;

    const pdfBuffer = await invoiceService.generateInvoicePdf(payment, member, plan);

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    // Standard PDF header magic bytes %PDF-
    const headerStr = pdfBuffer.slice(0, 5).toString("utf-8");
    expect(headerStr).toBe("%PDF-");
  });

  test("2. generateInvoicePdf handles pending payment and fallback member details", async () => {
    const payment = new Payment();
    payment._id = new ObjectId();
    payment.memberId = new ObjectId();
    payment.planId = new ObjectId();
    payment.amount = 4999;
    payment.status = "PENDING";
    payment.paymentMethod = "upi";
    payment.transactionId = "pay_pending_123";
    payment.createdAt = new Date();

    const member = new Member();
    member._id = payment.memberId;
    member.fullName = "Karthik";
    member.mobileNumber = "9876543210";

    const pdfBuffer = await invoiceService.generateInvoicePdf(payment, member, null);

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.slice(0, 5).toString("utf-8")).toBe("%PDF-");
  });
});
