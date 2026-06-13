import { JsonController, Post, Body, Res, HttpCode, UnauthorizedError, BadRequestError } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../../data-source";
import { Member } from "../../entity/Member";
import { Verification } from "../../entity/Verification";
import { UserToken } from "../../entity/UserToken";
import { MobileLoginDto, MobileSendOtpDto, MobileVerifyOtpLoginDto, ResetPinDto } from "../../dto/mobile/Auth.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { MailService } from "../../services/mail.service";
import { sendOTPSMS } from "../../utils/sms";
import bcrypt from "bcryptjs";

@JsonController("/auth")
export class MobileAuthController {
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private verificationRepo = AppDataSource.getMongoRepository(Verification);
  private tokenRepo = AppDataSource.getMongoRepository(UserToken);

  /**
   * @swagger
   * /mobile-api/auth/login-pin:
   *   post:
   *     summary: Member login using email/phone and PIN
   *     tags: [Mobile Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/MobileLoginDto'
   *     responses:
   *       200:
   *         description: Login successful
   */
  @Post("/login-pin")
  @HttpCode(StatusCodes.OK)
  async loginWithPin(@Body() body: MobileLoginDto, @Res() res: any) {
    try {
      const { identifier, pin } = body;

      const member = await this.memberRepo.findOne({
        where: {
          $or: [
            { email: identifier },
            { mobileNumber: identifier }
          ],
          isDeleted: false
        }
      });

      if (!member) {
        throw new UnauthorizedError("Invalid credentials");
      }

      const isMatch = await bcrypt.compare(pin, member.pin);
      if (!isMatch) {
        throw new UnauthorizedError("Invalid credentials");
      }

      const token = await this.generateToken(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Login successful",
        accessToken: token,
        data: {
          _id: member._id,
          fullName: member.fullName,
          mobileNumber: member.mobileNumber,
          email: member.email
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/auth/send-otp:
   *   post:
   *     summary: Send OTP to member email or phone for login
   *     tags: [Mobile Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/MobileSendOtpDto'
   *     responses:
   *       200:
   *         description: OTP sent successfully
   */
  @Post("/send-otp")
  @HttpCode(StatusCodes.OK)
  async sendOtp(@Body() body: MobileSendOtpDto, @Res() res: any) {
    try {
      const { identifier, type } = body;

      const member = await this.memberRepo.findOne({
        where: type === "email" ? { email: identifier } : { mobileNumber: identifier }
      });

      if (!member) {
        throw new BadRequestError("Member not found with this " + type);
      }

      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      let verification = await this.verificationRepo.findOne({
        where: { identifier, type, isVerified: false }
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
          isVerified: false
        });
      }

      await this.verificationRepo.save(verification);

      if (type === "email") {
        await MailService.sendVerificationOTP(identifier, otp);
      } else {
        await sendOTPSMS(identifier, otp);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Verification code sent to ${type}`
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/auth/verify-otp:
   *   post:
   *     summary: Verify OTP and login member
   *     tags: [Mobile Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/MobileVerifyOtpLoginDto'
   *     responses:
   *       200:
   *         description: Login successful
   */
  @Post("/verify-otp")
  @HttpCode(StatusCodes.OK)
  async verifyOtpLogin(@Body() body: MobileVerifyOtpLoginDto, @Res() res: any) {
    try {
      const { identifier, type, otp, fcmToken } = body;

      // Test bypass
      if (otp !== "1234") {
        const verification = await this.verificationRepo.findOne({
          where: { identifier, type, otp, isVerified: false }
        });

        if (!verification) {
          throw new BadRequestError("Invalid or expired verification code");
        }

        if (new Date() > verification.expiresAt) {
          throw new BadRequestError("Verification code has expired");
        }

        verification.isVerified = true;
        await this.verificationRepo.save(verification);
      }

      const member = await this.memberRepo.findOne({
        where: type === "email" ? { email: identifier } : { mobileNumber: identifier }
      });

      if (!member) {
        throw new UnauthorizedError("User not found");
      }

      if (fcmToken) {
        member.fcmToken = fcmToken;
        await this.memberRepo.save(member);
      }

      const token = await this.generateToken(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Login successful",
        accessToken: token,
        data: {
          _id: member._id,
          fullName: member.fullName,
          mobileNumber: member.mobileNumber,
          email: member.email
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/auth/reset-pin:
   *   post:
   *     summary: Reset member PIN after OTP verification
   *     tags: [Mobile Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ResetPinDto'
   *     responses:
   *       200:
   *         description: PIN reset successful
   */
  @Post("/reset-pin")
  @HttpCode(StatusCodes.OK)
  async resetPin(@Body() body: ResetPinDto, @Res() res: any) {
    try {
      const { identifier, type, newPin } = body;

      const verification = await this.verificationRepo.findOne({
        where: { identifier, type, isVerified: true },
        order: { createdAt: "DESC" }
      });

      if (!verification) {
        throw new BadRequestError("Please verify your " + type + " first");
      }

      // Check if verification is recent (e.g., within last 15 minutes)
      const fifteenMinutesAgo = new Date();
      fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);
      if (verification.createdAt < fifteenMinutesAgo) {
        throw new BadRequestError("Verification expired. Please request a new OTP.");
      }

      const member = await this.memberRepo.findOne({
        where: type === "email" ? { email: identifier } : { mobileNumber: identifier }
      });

      if (!member) {
        throw new BadRequestError("Member not found");
      }

      member.pin = await bcrypt.hash(newPin, 10);
      await this.memberRepo.save(member);

      // Optionally, consume the verification
      verification.isVerified = false;
      await this.verificationRepo.save(verification);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "PIN reset successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private async generateToken(member: Member): Promise<string> {
    const existingToken = await this.tokenRepo.findOne({
      where: { userId: member._id }
    });

    if (existingToken) {
      try {
        jwt.verify(existingToken.token, process.env.JWT_SECRET as string);
        const token = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          process.env.JWT_SECRET as string
        );

        existingToken.token = token;
        await this.tokenRepo.save(existingToken);
        return token;
      } catch (error: any) {
        const token = jwt.sign(
          {
            userId: member._id.toString(),
            userType: "MEMBER"
          },
          process.env.JWT_SECRET as string
        );

        existingToken.token = token;
        await this.tokenRepo.save(existingToken);
        return token;
      }
    }

    const token = jwt.sign(
      {
        userId: member._id.toString(),
        userType: "MEMBER"
      },
      process.env.JWT_SECRET as string
    );

    const userToken = new UserToken();
    userToken.userId = member._id;
    userToken.token = token;
    await this.tokenRepo.save(userToken);

    return token;
  }
}
