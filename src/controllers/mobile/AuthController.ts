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
import { isStoreTestOtpValid, isStoreTestMobileNumber } from "../../config/storeTest.config";
import { generateSecureOtp } from "../../utils";
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
      if (member.status === MemberStatus.BLOCKED) {
        throw new UnauthorizedError("Account is blocked. Please contact administrator.");
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

      member.lastLoggedIn = new Date();
      if (member.status === MemberStatus.INACTIVE) {
        member.status = MemberStatus.ACTIVE;
      }
      await this.memberRepo.save(member);

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
      if (member.status === MemberStatus.BLOCKED) {
        throw new BadRequestError("Account is blocked. Please contact administrator.");
      }

      const otp = generateSecureOtp(4);
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
        await sendOTPSMS(identifier, otp, member.fullName || "customer");
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

      // Resolve the member first so we can check the mobile number for
      // store-test eligibility BEFORE touching the verification record.
      const member = await this.memberRepo.findOne({
        where: type === "email" ? { email: identifier, isDeleted: false } : { mobileNumber: identifier, isDeleted: false }
      });

      if (!member) {
        throw new UnauthorizedError("User not found");
      }

      // ── OTP verification ─────────────────────────────────────────────────
      // The store-test OTP is allowed ONLY when:
      //   • STORE_TEST_OTP_ENABLED=true in env
      //   • The member's mobileNumber is in STORE_TEST_MOBILE_NUMBERS
      //   • The supplied OTP matches STORE_TEST_OTP exactly
      // All other accounts (and any wrong OTP) go through the normal flow.
      const storeTestBypassed = isStoreTestOtpValid(member.mobileNumber, otp);

      if (storeTestBypassed) {
        // Log that the controlled test path was used — without exposing the OTP or the number
        console.log("[StoreTestOTP] Controlled store-review login path used.");
      } else {
        // Normal OTP verification path
        const verification = await this.verificationRepo.findOne({
          where: { identifier, type, otp, isVerified: false }
        });

        if (!verification) {
          // If the identifier is a configured test number attempting a wrong OTP,
          // give the same generic error to avoid leaking which numbers are configured.
          if (isStoreTestMobileNumber(member.mobileNumber)) {
            console.log("[StoreTestOTP] Test number attempted with incorrect OTP.");
          }
          throw new BadRequestError("Invalid or expired verification code");
        }

        if (new Date() > verification.expiresAt) {
          throw new BadRequestError("Verification code has expired");
        }

        verification.isVerified = true;
        await this.verificationRepo.save(verification);
      }
      // ─────────────────────────────────────────────────────────────────────

      // All account-status, session, and token-creation checks run unconditionally
      // regardless of which OTP path was taken.
      if (member.status === MemberStatus.BLOCKED) {
        throw new BadRequestError("Account is blocked. Please contact administrator.");
      }
      if (member.status === MemberStatus.INACTIVE) {
        member.status = MemberStatus.ACTIVE;
      }
      member.lastLoggedIn = new Date();
      if (fcmToken) {
        member.fcmToken = fcmToken;
      }
      await this.memberRepo.save(member);

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

  /**
   * @swagger
   * /mobile-api/auth/logout:
   *   post:
   *     summary: Member logout (invalidates current session token)
   *     tags: [Mobile Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Logout successful
   */
  @Post("/logout")
  @HttpCode(StatusCodes.OK)
  @UseBefore(MobileAuthMiddleware)
  async logout(@Req() req: any, @Res() res: any) {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const memberId = req.user.userId;

      if (token) {
        await this.tokenRepo.deleteMany({
          userId: new ObjectId(memberId),
          token: token
        } as any);
      }

      // Clear FCM token on logout so push notifications stop arriving for this device
      await this.memberRepo.updateOne(
        { _id: new ObjectId(memberId) },
        { $unset: { fcmToken: "" } } as any
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Logout successful"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/auth/logout-all:
   *   post:
   *     summary: Logout from all devices (invalidates all sessions for this member)
   *     tags: [Mobile Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Logged out from all devices successfully
   */
  @Post("/logout-all")
  @HttpCode(StatusCodes.OK)
  @UseBefore(MobileAuthMiddleware)
  async logoutAll(@Req() req: any, @Res() res: any) {
    try {
      const memberId = req.user.userId;

      await this.tokenRepo.deleteMany({
        userId: new ObjectId(memberId)
      } as any);

      await this.memberRepo.updateOne(
        { _id: new ObjectId(memberId) },
        { $unset: { fcmToken: "" } } as any
      );

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Logged out from all devices successfully"
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
