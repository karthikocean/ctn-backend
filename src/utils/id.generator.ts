import crypto from "crypto";
import { AppDataSource } from "../data-source";
import { AdminUser } from "../entity/AdminUser";
import { Payment } from "../entity/Payment";

export async function generateInvoiceNumber(): Promise<string> {
  try {
    const paymentRepo = AppDataSource.getMongoRepository(Payment);

    const [byCreatedAt, byInvoiceNo] = await Promise.all([
      paymentRepo.find({
        where: {
          invoiceNumber: { $regex: "^OSINV-TN\\d+$", $options: "i" }
        } as any,
        order: { createdAt: "DESC" as any },
        take: 50
      }),
      paymentRepo.find({
        where: {
          invoiceNumber: { $regex: "^OSINV-TN\\d+$", $options: "i" }
        } as any,
        order: { invoiceNumber: "DESC" as any },
        take: 50
      })
    ]);

    const allPayments = [...byCreatedAt, ...byInvoiceNo];
    let maxNum = 0;
    for (const p of allPayments) {
      if (p.invoiceNumber) {
        const match = p.invoiceNumber.match(/^OSINV-TN(\d+)$/i);
        if (match && match[1]) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > maxNum) {
            maxNum = val;
          }
        }
      }
    }

    let nextNum = maxNum + 1;
    let candidate = `OSINV-TN${nextNum.toString().padStart(3, "0")}`;

    let exists = await paymentRepo.findOneBy({ invoiceNumber: candidate });
    while (exists) {
      nextNum++;
      candidate = `OSINV-TN${nextNum.toString().padStart(3, "0")}`;
      exists = await paymentRepo.findOneBy({ invoiceNumber: candidate });
    }

    return candidate;
  } catch (err) {
    throw err;
  }
}

export async function generateAdminUserId(): Promise<string> {
  try {
    const lastAdminUser = await AppDataSource.getMongoRepository(AdminUser).findOne({
      where: {},
      order: { createdAt: "DESC" as any }
    });

    const lastId = lastAdminUser?.userId?.replace("US", "") || "000";
    const numeric = parseInt(lastId) || 0;
    const newId = `US${(numeric + 1).toString().padStart(3, "0")}`;
    return newId;
  } catch (err) {
    throw err;
  }
}

/**
 * Generates a cryptographically secure random numeric OTP string of given length.
 * Default is 4 digits (range 1000 - 9999).
 */
export function generateSecureOtp(digits: number = 4): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits);
  return crypto.randomInt(min, max).toString();
}


