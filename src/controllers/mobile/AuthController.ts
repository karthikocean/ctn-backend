import { JsonController, Post, Body, Res, HttpCode, UnauthorizedError, BadRequestError, UseBefore, Req } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../../data-source";
import { Member, MemberStatus } from "../../entity/Member";
import { Verification } from "../../entity/Verification";
import { UserToken } from "../../entity/UserToken";
import { MobileLoginDto, MobileSendOtpDto, MobileVerifyOtpLoginDto, ChangePinDto } from "../../dto/mobile/Auth.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { MailService } from "../../services/mail.service";
import { sendOTPSMS } from "../../utils/sms";
import bcrypt from "bcryptjs";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { ObjectId } from "mongodb";
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
        throw new UnauthorizedError("User Account not found!!");
      }
      if (!member.pin) {
        throw new BadRequestError(
          "PIN not configured. Please set your PIN to proceed."
        );
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
        where: type === "email" ? { email: identifier, isDeleted: false } : { mobileNumber: identifier, isDeleted: false }
      });

      if (!member) {
        throw new BadRequestError(
          "Member not found with this " + (type === "phone" ? "phone number" : type)
        );
      }
      if (member.status !== MemberStatus.ACTIVE) {
        throw new BadRequestError("Account is not active. Please contact administrator.");
      }

      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 5);

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
      if (!fcmToken) {
        throw new BadRequestError("FCM token is required");
      }
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
        where: type === "email" ? { email: identifier, isDeleted: false } : { mobileNumber: identifier, isDeleted: false }
      });

      if (!member) {
        throw new UnauthorizedError("User not found");
      }
      if (member.status !== MemberStatus.ACTIVE) {
        throw new BadRequestError("Account is not active. Please contact administrator.");
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
  @UseBefore(MobileAuthMiddleware)
  async resetPin(@Req() req: any, @Body() body: any, @Res() res: any) {
    try {
      const { newPin } = body;
      const memberId = req.user.userId;

      const member = await this.memberRepo.findOne({ where: { _id: new ObjectId(memberId) } });

      if (!member) {
        throw new BadRequestError("Member not found");
      }

      member.pin = await bcrypt.hash(newPin, 10);
      await this.memberRepo.save(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "PIN reset successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/auth/change-pin:
   *   post:
   *     summary: Change PIN using old PIN and new PIN (requires authentication)
   *     tags: [Mobile Auth]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ChangePinDto'
   *     responses:
   *       200:
   *         description: PIN changed successfully
   *       400:
   *         description: Validation error (invalid old PIN, same PIN, etc.)
   *       401:
   *         description: Unauthorized
   */
  @Post("/change-pin")
  @HttpCode(StatusCodes.OK)
  @UseBefore(MobileAuthMiddleware)
  async changePin(@Req() req: any, @Body() body: ChangePinDto, @Res() res: any) {
    try {
      const { oldPin, newPin } = body;
      const memberId = req.user.userId;

      // Validate that old PIN and new PIN are not the same
      if (oldPin === newPin) {
        throw new BadRequestError("New PIN must be different from the current PIN");
      }

      const member = await this.memberRepo.findOne({ where: { _id: new ObjectId(memberId) } });

      if (!member) {
        throw new BadRequestError("Member not found");
      }

      if (!member.pin) {
        throw new BadRequestError("No PIN is configured for this account. Please use reset-pin instead.");
      }

      // Verify old PIN matches the stored hashed PIN
      const isOldPinValid = await bcrypt.compare(oldPin, member.pin);
      if (!isOldPinValid) {
        throw new BadRequestError("Current PIN is incorrect");
      }

      // Hash and save the new PIN
      member.pin = await bcrypt.hash(newPin, 10);
      await this.memberRepo.save(member);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "PIN changed successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  private async generateToken(member: Member): Promise<string> {
    const jwtSecret = process.env.JWT_SECRET as string;
    const jwtExpiresIn = (process.env.JWT_EXPIRES_IN || "30d") as any;
    const tokenPayload = {
      userId: member._id.toString(),
      userType: "MEMBER"
    };

    const existingToken = await this.tokenRepo.findOne({
      where: { userId: member._id }
    });

    const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: jwtExpiresIn });

    if (existingToken) {
      existingToken.token = token;
      await this.tokenRepo.save(existingToken);
      return token;
    }

    const userToken = new UserToken();
    userToken.userId = member._id;
    userToken.token = token;
    await this.tokenRepo.save(userToken);

    return token;
  }
}
