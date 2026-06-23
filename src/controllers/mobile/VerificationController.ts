import { JsonController, Post, Body, Res, HttpCode, BadRequestError } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { AppDataSource } from "../../data-source";
import { Verification } from "../../entity/Verification";
import { Member, MemberStatus } from "../../entity/Member";
import { MailService } from "../../services/mail.service";
import { SendOtpDto, VerifyOtpDto } from "../../dto/mobile/Verification.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { sendOTPSMS } from "../../utils/sms";

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

      if (isRegister) {
        if (phone) {
          const member = await this.memberRepo.findOne({
            where: { mobileNumber: phone, isDeleted: false }
          });
          if (!member) {
            throw new BadRequestError("Member not found with this phone number");
          }
          if (member.status !== MemberStatus.ACTIVE) {
            throw new BadRequestError("Member account is not active");
          }
        }

        if (email) {
          const member = await this.memberRepo.findOne({
            where: { email: email, isDeleted: false }
          });
          if (!member) {
            throw new BadRequestError("Member not found with this email address");
          }
          if (member.status !== MemberStatus.ACTIVE) {
            throw new BadRequestError("Member account is not active");
          }
        }

      }
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const messages: string[] = [];

      if (phone) {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        let verification = await this.verificationRepo.findOne({
          where: { identifier: phone, type: "phone", isVerified: false }
        });

        if (verification) {
          verification.otp = otp;
          verification.expiresAt = expiresAt;
        } else {
          verification = this.verificationRepo.create({
            identifier: phone,
            type: "phone",
            otp,
            expiresAt,
            isVerified: false
          });
        }

        await this.verificationRepo.save(verification);
        await sendOTPSMS(phone, otp);
        messages.push("phone");
      }

      if (email) {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        let verification = await this.verificationRepo.findOne({
          where: { identifier: email, type: "email", isVerified: false }
        });

        if (verification) {
          verification.otp = otp;
          verification.expiresAt = expiresAt;
        } else {
          verification = this.verificationRepo.create({
            identifier: email,
            type: "email",
            otp,
            expiresAt,
            isVerified: false
          });
        }

        await this.verificationRepo.save(verification);
        await MailService.sendVerificationOTP(email, otp);
        messages.push("email");
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Verification code sent to ${messages.join(" and ")}`
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

      // Test bypass
      if (otp === "1234") {
        return res.status(StatusCodes.OK).json({
          message: `${type === "email" ? "Email" : "Phone"} verified successfully`
        });
      }

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
