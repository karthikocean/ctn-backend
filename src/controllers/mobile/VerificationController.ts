import { JsonController, Post, Body, Res, HttpCode, BadRequestError } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { AppDataSource } from "../../data-source";
import { Verification } from "../../entity/Verification";
import { Member, MemberStatus } from "../../entity/Member";
import { MailService } from "../../services/mail.service";
import { SendOtpDto, VerifyOtpDto } from "../../dto/mobile/Verification.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { sendOTPSMS } from "../../utils/sms";
import { isStoreTestOtpValid } from "../../config/storeTest.config";
import { generateSecureOtp } from "../../utils";

@JsonController("/verification")
export class VerificationController {
  private verificationRepo = AppDataSource.getMongoRepository(Verification);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /mobile-api/verification/send-otp:
   *   post:
   *     summary: Send a 4-digit OTP to the user's email or phone
   *     tags: [Mobile Verification]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/SendOtpDto'
   *     responses:
   *       200:
   *         description: OTP sent successfully
   */
  @Post("/send-otp")
  @HttpCode(StatusCodes.OK)
  async sendOtp(@Body() body: SendOtpDto, @Res() res: any) {
    try {
      const { phone, email, isRegister } = body;

      if (!phone && !email) {
        throw new BadRequestError("At least phone or email must be provided");
      }

      // Validate member
      const validateMember = async (
        field: "mobileNumber" | "email",
        value: string,
        label: string
      ) => {
        const member = await this.memberRepo.findOne({
          where: {
            [field]: value,
            isDeleted: false,
          },
        });

        if (isRegister) {
          if (!member) {
            throw new BadRequestError(`Member not found with this ${label}`);
          }

          if (member.status !== MemberStatus.ACTIVE) {
            throw new BadRequestError("Member account is not active");
          }
        } else {
          if (member) {
            throw new BadRequestError(
              `Member already exists with this ${label}`
            );
          }
        }
      };

      // Validate phone & email in parallel
      await Promise.all([
        phone
          ? validateMember("mobileNumber", phone, "phone number")
          : Promise.resolve(),
        email
          ? validateMember("email", email, "email address")
          : Promise.resolve(),
      ]);

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const messages: string[] = [];

      const sendOtp = async (
        identifier: string,
        type: "phone" | "email"
      ) => {
        const otp = generateSecureOtp(4);

        let verification = await this.verificationRepo.findOne({
          where: {
            identifier,
            type,
            isVerified: false,
          },
        });

        if (verification) {
          verification.otp = otp;
          verification.expiresAt = expiresAt;
        } else {
          verification = this.verificationRepo.create({
            identifier,
            type,
            otp,
            expiresAt,
            isVerified: false,
          });
        }

        await this.verificationRepo.save(verification);

        if (type === "phone") {
          await sendOTPSMS(identifier, otp);
        } else {
          await MailService.sendVerificationOTP(identifier, otp);
        }

        messages.push(type);
      };

      // Send OTPs in parallel
      await Promise.all([
        phone ? sendOtp(phone, "phone") : Promise.resolve(),
        email ? sendOtp(email, "email") : Promise.resolve(),
      ]);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Verification code sent to ${messages.join(" and ")}`,
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
  /**
   * @swagger
   * /mobile-api/verification/verify-otp:
   *   post:
   *     summary: Verify the 4-digit OTP sent to the user's email or phone
   *     tags: [Mobile Verification]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/VerifyOtpDto'
   *     responses:
   *       200:
   *         description: Verified successfully
   *       400:
   *         description: Invalid or expired OTP
   */
  @Post("/verify-otp")
  @HttpCode(StatusCodes.OK)
  async verifyOtp(@Body() body: VerifyOtpDto, @Res() res: any) {
    try {
      let { identifier, type, phone, email, otp } = body;

      if (!identifier) {
        if (phone) {
          identifier = phone;
          type = "phone";
        } else if (email) {
          identifier = email;
          type = "email";
        }
      }

      if (!identifier || !type) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: "At least identifier/type, or phone, or email must be provided"
        });
      }

      // ── Store-test OTP shortcut ────────────────────────────────────────────
      // Only applies when:
      //   • type === "phone"  (test accounts are phone-based)
      //   • STORE_TEST_OTP_ENABLED=true
      //   • identifier is in STORE_TEST_MOBILE_NUMBERS
      //   • otp matches STORE_TEST_OTP exactly
      // In all other cases the normal verification-record check runs.
      if (type === "phone" && isStoreTestOtpValid(identifier, otp)) {
        console.log("[StoreTestOTP] Controlled store-review phone-verification path used.");
        return res.status(StatusCodes.OK).json({
          message: "Phone verified successfully"
        });
      }
      // ──────────────────────────────────────────────────────────────────────

      // Normal verification path
      const verification = await this.verificationRepo.findOne({
        where: { identifier, type, otp, isVerified: false }
      });

      if (!verification) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: "Invalid or expired verification code"
        });
      }

      if (new Date() > verification.expiresAt) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: "Verification code has expired"
        });
      }

      verification.isVerified = true;
      await this.verificationRepo.save(verification);

      return res.status(StatusCodes.OK).json({
        message: `${type === "email" ? "Email" : "Phone"} verified successfully`
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
