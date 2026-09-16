import crypto from "crypto";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError, ForbiddenError } from "routing-controllers";
import { AppDataSource } from "../data-source";
import { Payment } from "../entity/Payment";
import { Member, MemberStatus } from "../entity/Member";
import { Announcement, AnnouncementStatus, AnnouncementType } from "../entity/Announcement";
import { AnnouncementBooking } from "../entity/AnnouncementBooking";
import { validateModuleUsage } from "./moduleUsage.service";
import { generateInvoiceNumber } from "../utils/id.generator";
import { insertPushNotification } from "./pushnotification.service";
import { NotificationModule } from "../entity/PushNotifications";

const Razorpay = require("razorpay");

let razorpayInstance: any = null;

const getRazorpayInstance = () => {
  if (!razorpayInstance) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
      throw new BadRequestError("Razorpay credentials are not configured in the environment variables.");
    }

    razorpayInstance = new Razorpay({
      key_id,
      key_secret
    });
  }
  return razorpayInstance;
};

export class EventRazorpayService {
  private get paymentRepo() {
    return AppDataSource.getMongoRepository(Payment);
  }
  private get memberRepo() {
    return AppDataSource.getMongoRepository(Member);
  }
  private get announcementRepo() {
    return AppDataSource.getMongoRepository(Announcement);
  }
  private get eventBookingRepo() {
    return AppDataSource.getMongoRepository(AnnouncementBooking);
  }

  /**
   * Initiate Razorpay checkout order for paid event booking
   */
  async initiateBuy(memberId: string, announcementId: string) {
    if (!ObjectId.isValid(memberId)) throw new BadRequestError("Invalid member ID");
    if (!ObjectId.isValid(announcementId)) throw new BadRequestError("Invalid announcement ID");

    const memberOid = new ObjectId(memberId);
    const announcementOid = new ObjectId(announcementId);

    const member = await this.memberRepo.findOneBy({ _id: memberOid, isDeleted: false });
    if (!member) throw new NotFoundError("Member not found");
    if (member.status === MemberStatus.INACTIVE || member.status === MemberStatus.BLOCKED) {
      throw new BadRequestError("Member account is inactive or blocked");
    }

    const now = new Date();
    const announcement = await this.announcementRepo.findOne({
      where: {
        _id: announcementOid,
        isDeleted: false,
        $or: [
          { status: AnnouncementStatus.PUBLISHED },
          {
            status: AnnouncementStatus.SCHEDULED,
            scheduleDate: { $lte: now }
          }
        ]
      }
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found or not active");
    }

    if (announcement.announcementType !== AnnouncementType.EVENT) {
      throw new BadRequestError("Only event announcements can be booked via payment");
    }

    const amount = announcement.amount;
    if (!amount || amount <= 0) {
      throw new BadRequestError(
        "This event does not require direct payment. Please use the point booking or register endpoint."
      );
    }

    // 1. Check if member already booked this event
    const existingBooking = await this.eventBookingRepo.findOne({
      where: {
        announcementId: announcementOid,
        memberId: memberOid,
        status: "booked"
      }
    });

    if (existingBooking) {
      throw new BadRequestError("You have already booked this event");
    }

    // 2. Check registration limits
    if (announcement.membersLimit > 0) {
      const bookedCount = await this.eventBookingRepo.count({
        announcementId: announcementOid,
        status: "booked"
      } as any);

      if (bookedCount >= announcement.membersLimit) {
        throw new BadRequestError("This event is fully booked");
      }
    }

    // 3. Validate Event booking capacity under active plan
    await validateModuleUsage(memberOid, "Event");

    // 4. Create Razorpay Order
    const amountInPaise = Math.round(amount * 100);
    const rzpOrder = await getRazorpayInstance().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `ev_rcpt_${Date.now()}`
    });

    // 5. Create PENDING Payment in DB
    const payment = new Payment();
    payment.memberId = memberOid;
    payment.announcementId = announcementOid;
    payment.amount = amount;
    payment.paymentMethod = "razorpay";
    payment.transactionId = rzpOrder.id;
    payment.status = "PENDING";
    payment.action = "event_booking";
    payment.source = "app";
    payment.isDeleted = false;

    await this.paymentRepo.save(payment);

    return {
      razorpayOrderId: rzpOrder.id,
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID || "",
      announcement: {
        _id: announcement._id,
        title: announcement.title,
        amount: announcement.amount
      }
    };
  }

  /**
   * Verify Razorpay payment signature, mark payment as COMPLETED, and create the event booking
   */
  async verifyPayment(
    memberId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string
  ) {
    const secret = process.env.RAZORPAY_KEY_SECRET || "";
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (generatedSignature !== razorpaySignature) {
      const payment = await this.paymentRepo.findOneBy({ transactionId: razorpayOrderId });
      if (payment) {
        payment.status = "FAILED";
        payment.remarks = "Payment signature verification failed";
        await this.paymentRepo.save(payment);
      }
      throw new BadRequestError("Invalid payment signature. Verification failed.");
    }

    const payment = await this.paymentRepo.findOneBy({ transactionId: razorpayOrderId });
    if (!payment) throw new NotFoundError("Payment record not found");

    if (payment.memberId && payment.memberId.toString() !== memberId) {
      throw new ForbiddenError("You are not authorized to verify this payment transaction");
    }

    if (payment.status === "COMPLETED") {
      const existingBooking = await this.eventBookingRepo.findOne({
        where: { paymentId: payment._id }
      });
      return {
        success: true,
        message: "Payment already processed.",
        data: {
          bookingId: existingBooking?._id,
          paymentId: payment._id,
          announcementId: payment.announcementId,
          amountPaid: payment.amount,
          transactionId: payment.transactionId,
          invoiceNumber: payment.invoiceNumber
        }
      };
    }

    // Mark payment as COMPLETED
    payment.status = "COMPLETED";
    if (!payment.invoiceNumber) {
      payment.invoiceNumber = await generateInvoiceNumber();
    }
    await this.paymentRepo.save(payment);

    // Create or find Booking
    let booking = await this.eventBookingRepo.findOne({
      where: {
        announcementId: payment.announcementId!,
        memberId: payment.memberId,
        status: "booked"
      }
    });

    if (!booking) {
      booking = this.eventBookingRepo.create({
        announcementId: payment.announcementId!,
        memberId: payment.memberId,
        pointsSpent: 0,
        amountPaid: payment.amount,
        paymentMethod: "razorpay",
        transactionId: razorpayPaymentId,
        paymentId: payment._id,
        status: "booked"
      });
      await this.eventBookingRepo.save(booking);
    } else {
      booking.paymentId = payment._id;
      booking.amountPaid = payment.amount;
      booking.paymentMethod = "razorpay";
      booking.transactionId = razorpayPaymentId;
      await this.eventBookingRepo.save(booking);
    }

    payment.bookingId = booking._id;
    await this.paymentRepo.save(payment);

    // Send push notification to member
    try {
      const [member, announcement] = await Promise.all([
        this.memberRepo.findOneBy({ _id: payment.memberId }),
        this.announcementRepo.findOneBy({ _id: payment.announcementId! })
      ]);

      if (member?.fcmToken && announcement) {
        await insertPushNotification({
          token: member.fcmToken,
          subject: "Event Booking Confirmed",
          content: `Your booking for "${announcement.title}" has been successfully confirmed.`,
          moduleName: NotificationModule.EVENT,
          moduleId: announcement._id.toString(),
          receiverId: member._id.toString()
        });
      }
    } catch {
      // Notification errors do not fail payment verification
    }

    return {
      success: true,
      message: "Event booked successfully via Razorpay",
      data: {
        bookingId: booking._id,
        announcementId: payment.announcementId,
        paymentId: payment._id,
        amountPaid: payment.amount,
        transactionId: razorpayPaymentId,
        invoiceNumber: payment.invoiceNumber
      }
    };
  }

  /**
   * Cancel a pending Razorpay event payment transaction
   */
  async cancelPayment(memberId: string, razorpayOrderId: string) {
    const payment = await this.paymentRepo.findOneBy({ transactionId: razorpayOrderId });
    if (!payment) throw new NotFoundError("Payment transaction not found");

    if (payment.memberId && payment.memberId.toString() !== memberId) {
      throw new ForbiddenError("You are not authorized to cancel this payment transaction");
    }

    if (payment.status === "COMPLETED") {
      throw new BadRequestError("Cannot cancel an already completed payment transaction");
    }

    payment.status = "FAILED";
    payment.remarks = "Payment cancelled by user";
    await this.paymentRepo.save(payment);

    return {
      success: true,
      message: "Payment transaction cancelled successfully"
    };
  }
}
