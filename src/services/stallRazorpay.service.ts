import crypto from "crypto";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError, ForbiddenError } from "routing-controllers";
import { AppDataSource } from "../data-source";
import { Payment } from "../entity/Payment";
import { Member, MemberStatus } from "../entity/Member";
import { Announcement, AnnouncementStatus } from "../entity/Announcement";
import { AnnouncementBooking } from "../entity/AnnouncementBooking";
import { StallBooking } from "../entity/StallBooking";
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

export class StallRazorpayService {
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
  private get stallBookingRepo() {
    return AppDataSource.getMongoRepository(StallBooking);
  }

  /**
   * Initiate Razorpay checkout order for paid stall booking
   */
  async initiateBuy(memberId: string, announcementId: string, stallId: string) {
    if (!ObjectId.isValid(memberId)) throw new BadRequestError("Invalid member ID");
    if (!ObjectId.isValid(announcementId)) throw new BadRequestError("Invalid announcement ID");
    if (!ObjectId.isValid(stallId)) throw new BadRequestError("Invalid stall ID");

    const memberOid = new ObjectId(memberId);
    const announcementOid = new ObjectId(announcementId);
    const stallOid = new ObjectId(stallId);

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

    if (!announcement.isOfflineStallExist) {
      throw new BadRequestError("Offline stalls are not enabled for this announcement");
    }

    const stalls = announcement.stallConfig?.stalls || [];
    const stall = stalls.find((s: any) => s._id?.toString() === stallId);
    if (!stall) {
      throw new NotFoundError("Stall not found in announcement configuration");
    }

    const amount = stall.amount;
    if (!amount || amount <= 0) {
      throw new BadRequestError(
        "This stall does not have a payable amount configured. Please use point booking instead."
      );
    }

    // 1. Check if stall is already booked by anyone
    const existingStallBooking = await this.stallBookingRepo.findOne({
      where: {
        announcementId: announcementOid,
        stallId: stallOid,
        status: "booked"
      }
    });

    if (existingStallBooking) {
      throw new BadRequestError("This stall has already been booked by another member");
    }

    // 2. Check if this member has already booked this stall
    const memberStallBooking = await this.stallBookingRepo.findOne({
      where: {
        announcementId: announcementOid,
        stallId: stallOid,
        memberId: memberOid,
        status: "booked"
      }
    });

    if (memberStallBooking) {
      throw new BadRequestError("You have already booked this stall");
    }

    // 3. Check event booking capacity if member is not yet registered for the parent event
    const userEventBooking = await this.eventBookingRepo.findOne({
      where: {
        announcementId: announcementOid,
        memberId: memberOid,
        status: "booked"
      }
    });

    let needToBookEvent = false;
    if (!userEventBooking) {
      needToBookEvent = true;
      if (announcement.membersLimit > 0) {
        const bookedCount = await this.eventBookingRepo.count({
          announcementId: announcementOid,
          status: "booked"
        } as any);

        if (bookedCount >= announcement.membersLimit) {
          throw new BadRequestError("The event is fully booked, so you cannot book a stall");
        }
      }
    }

    // 4. Validate module usage under active subscription plan
    await validateModuleUsage(memberOid, "Offline Stall");
    if (needToBookEvent) {
      await validateModuleUsage(memberOid, "Event");
    }

    // 5. Create Razorpay Order
    const amountInPaise = Math.round(amount * 100);
    const rzpOrder = await getRazorpayInstance().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `stall_rcpt_${Date.now()}`
    });

    // 6. Create PENDING Payment in DB
    const payment = new Payment();
    payment.memberId = memberOid;
    payment.announcementId = announcementOid;
    payment.stallId = stallOid;
    payment.amount = amount;
    payment.paymentMethod = "razorpay";
    payment.transactionId = rzpOrder.id;
    payment.status = "PENDING";
    payment.action = "stall_booking";
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
        title: announcement.title
      },
      stall: {
        _id: stall._id,
        name: stall.name,
        size: stall.size,
        amount: stall.amount
      }
    };
  }

  /**
   * Verify Razorpay payment signature, mark payment COMPLETED, and create the stall booking (+ auto event booking)
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
      const existingBooking = await this.stallBookingRepo.findOne({
        where: { paymentId: payment._id }
      });
      return {
        success: true,
        message: "Payment already processed.",
        data: {
          bookingId: existingBooking?._id,
          paymentId: payment._id,
          announcementId: payment.announcementId,
          stallId: payment.stallId,
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

    // Auto-register parent event if member has not already registered
    const existingEventBooking = await this.eventBookingRepo.findOne({
      where: {
        announcementId: payment.announcementId!,
        memberId: payment.memberId,
        status: "booked"
      }
    });

    if (!existingEventBooking) {
      const autoEventBooking = this.eventBookingRepo.create({
        announcementId: payment.announcementId!,
        memberId: payment.memberId,
        pointsSpent: 0,
        amountPaid: 0,
        paymentMethod: "stall_bundle",
        status: "booked"
      });
      await this.eventBookingRepo.save(autoEventBooking);
    }

    // Create or update StallBooking
    let booking = await this.stallBookingRepo.findOne({
      where: {
        announcementId: payment.announcementId!,
        stallId: payment.stallId!,
        memberId: payment.memberId,
        status: "booked"
      }
    });

    if (!booking) {
      booking = this.stallBookingRepo.create({
        announcementId: payment.announcementId!,
        stallId: payment.stallId!,
        memberId: payment.memberId,
        pointsSpent: 0,
        amountPaid: payment.amount,
        paymentMethod: "razorpay",
        transactionId: razorpayPaymentId,
        paymentId: payment._id,
        status: "booked"
      });
      await this.stallBookingRepo.save(booking);
    } else {
      booking.paymentId = payment._id;
      booking.amountPaid = payment.amount;
      booking.paymentMethod = "razorpay";
      booking.transactionId = razorpayPaymentId;
      await this.stallBookingRepo.save(booking);
    }

    payment.bookingId = booking._id;
    await this.paymentRepo.save(payment);

    // Send push notification to member
    try {
      const [member, announcement] = await Promise.all([
        this.memberRepo.findOneBy({ _id: payment.memberId }),
        this.announcementRepo.findOneBy({ _id: payment.announcementId! })
      ]);

      const stall = announcement?.stallConfig?.stalls?.find(
        (s: any) => s._id?.toString() === payment.stallId?.toString()
      );
      const stallName = stall ? ` (${stall.name})` : "";

      if (member?.fcmToken && announcement) {
        await insertPushNotification({
          token: member.fcmToken,
          subject: "Stall Booking Confirmed",
          content: `Your stall booking${stallName} for "${announcement.title}" has been successfully confirmed.`,
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
      message: "Stall booked successfully via Razorpay",
      data: {
        bookingId: booking._id,
        announcementId: payment.announcementId,
        stallId: payment.stallId,
        paymentId: payment._id,
        amountPaid: payment.amount,
        transactionId: razorpayPaymentId,
        invoiceNumber: payment.invoiceNumber
      }
    };
  }

  /**
   * Cancel a pending Razorpay stall payment transaction
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
