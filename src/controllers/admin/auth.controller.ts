import {
  JsonController,
  Post,
  Body,
  HttpCode,
  UnauthorizedError,
  BadRequestError,
  Res
} from "routing-controllers";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { AppDataSource } from "../../data-source";
import { AdminUser } from "../../entity/AdminUser";
import { UserToken } from "../../entity/UserToken";
import { Verification } from "../../entity/Verification";

import { LoginDto, ChangePinDto, ForgotPinDto, VerifyOtpDto, ResetPinDto } from "../../dto/admin/Auth.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { UseBefore } from "routing-controllers";
import { MailService } from "../../services/mail.service";
import { Role } from "../../entity/Role.Permission";
import { generateSecureOtp } from "../../utils";
import { Franchise, FranchiseStatus } from "../../entity/Franchise";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PASSWORD_POLICY_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\;/]).{8,}$/;

@JsonController("/auth")
export class AuthController {

  /**
   * @swagger
   * /api/admin/auth/login:
   *   post:
   *     summary: Admin login using email and password
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/LoginDto'
   *     responses:
   *       200:
   *         description: Login successful
   *       400:
   *         description: Missing fields or invalid email
   *       401:
   *         description: Invalid credentials
   */
  @Post("/login")
  @HttpCode(StatusCodes.OK)
  async login(@Body() body: LoginDto, @Res() res: any) {
    try {
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";

      if (!email || !EMAIL_REGEX.test(email)) {
        throw new BadRequestError("Please provide a valid email address");
      }

      if (!password) {
        throw new BadRequestError("Password is required");
      }

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: {
          email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
          isDeleted: false
        } as any
      });

      if (!user) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const roleRepo = await AppDataSource.getMongoRepository(Role);
      const role = await roleRepo.findOne({ where: { _id: user.roleId } });
      if (!role) {
        throw new UnauthorizedError("Role not found");
      }

      if (role.code === "FRANCHISE_OWNER") {
        const franchiseOwnerRepo = AppDataSource.getMongoRepository(Franchise);
        const franchiseOwner = await franchiseOwnerRepo.findOne({ where: { userId: { $in: [user.id] } } });
        if (!franchiseOwner) {
          throw new UnauthorizedError("Franchise Owner not found");
        }
        if (franchiseOwner.status === FranchiseStatus.INACTIVE) {
          throw new UnauthorizedError("Franchise Owner is inactive. Please contact admin.");
        }
        if (franchiseOwner.isDeleted) {
          throw new UnauthorizedError("Franchise Owner is deleted. Please contact admin.");
        }
      }

      const credential = user.password || user.pin;
      if (!credential) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const isMatch = await bcrypt.compare(password, credential);
      if (!isMatch) {
        throw new UnauthorizedError("Invalid password");
      }

      // Check if the account is active
      if (!user.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact admin.");
      }

      // Generate new token and save to DB
      const finalToken = jwt.sign(
        {
          id: user.id.toString(),
          roleId: user.roleId.toString()
        },
        process.env.JWT_SECRET as string,
        {
          expiresIn: (process.env.JWT_EXPIRES_IN || "1d") as any
        }
      );

      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const userToken = new UserToken();
      userToken.userId = user.id;
      userToken.token = finalToken;
      await tokenRepo.save(userToken);

      // Update last login info
      user.lastLoginAt = new Date();
      // @ts-ignore
      user.lastLoginIp = res.req.ip;
      await userRepo.save(user);

      return res.status(StatusCodes.OK).json({
        message: "Login successful",
        accessToken: finalToken,
        user: {
          id: user.id.toString(),
          phoneNumber: user.phoneNumber,
          name: user.name,
          email: user.email,
          roleId: user.roleId.toString(),
          isActive: user.isActive
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/auth/change-pin:
   *   post:
   *     summary: Change admin user Password
   *     tags: [Auth]
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
   *         description: Password changed successfully
   *       400:
   *         description: Invalid old password
   *       401:
   *         description: Unauthorized
   */
  @Post("/change-pin")
  @UseBefore(AuthMiddleware)
  @HttpCode(StatusCodes.OK)
  async changePin(@Body() body: ChangePinDto, @Res() res: any) {
    try {
      const { oldPin, newPin } = body;
      const userId = (res.req as any).user.userId;

      if (oldPin && newPin && oldPin === newPin) {
        throw new BadRequestError("New password cannot be the same as current password");
      }

      if (!newPin || !PASSWORD_POLICY_REGEX.test(newPin)) {
        throw new BadRequestError("Password must be at least 8 characters long and include an uppercase letter, a number, and a special character");
      }

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: { _id: new ObjectId(userId) }
      });

      if (!user) {
        throw new UnauthorizedError("User not found");
      }

      const credential = user.password || user.pin;
      const isMatch = credential ? await bcrypt.compare(oldPin, credential) : false;
      if (!isMatch) {
        throw new BadRequestError("Invalid current password");
      }

      const hashedNew = await bcrypt.hash(newPin, 10);
      user.pin = hashedNew;
      user.password = hashedNew;
      await userRepo.save(user);

      return res.status(StatusCodes.OK).json({
        message: "Password changed successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/auth/logout:
   *   post:
   *     summary: Logout and invalidate session
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Logout successful
   *       401:
   *         description: Unauthorized
   */
  @Post("/logout")
  @UseBefore(AuthMiddleware)
  @HttpCode(StatusCodes.OK)
  async logout(@Res() res: any) {
    try {
      const authHeader = res.req.headers.authorization;
      const token = authHeader.split(" ")[1];
      const userId = (res.req as any).user.userId;

      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      await tokenRepo.deleteMany({
        userId: new ObjectId(userId),
        token: token
      });

      return res.status(StatusCodes.OK).json({
        message: "Logout successful"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/auth/forgot-pin:
   *   post:
   *     summary: Send OTP to admin email for password reset
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ForgotPinDto'
   *     responses:
   *       200:
   *         description: OTP sent successfully
   *       400:
   *         description: User account not found or invalid email
   */
  @Post("/forgot-pin")
  @HttpCode(StatusCodes.OK)
  async forgotPin(@Body() body: ForgotPinDto, @Res() res: any) {
    try {
      const email = (body.email || "").trim().toLowerCase();

      if (!email || !EMAIL_REGEX.test(email)) {
        throw new BadRequestError("Please provide a valid email address");
      }

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: {
          email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
          isDeleted: false
        } as any
      });

      if (!user) {
        throw new BadRequestError("Admin User not found with this email address");
      }

      const targetEmail = (user.email || email).toLowerCase().trim();
      const otp = generateSecureOtp(4);
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const verificationRepo = AppDataSource.getMongoRepository(Verification);

      // Clean up any existing verification records for this email first
      await verificationRepo.deleteMany({ identifier: targetEmail });

      // Create a fresh verification record
      const verification = verificationRepo.create({
        identifier: targetEmail,
        type: "email",
        otp,
        expiresAt,
        isVerified: false
      });

      await verificationRepo.save(verification);

      try {
        await MailService.sendVerificationOTP(targetEmail, otp);
      } catch (mailError) {
        console.error("Failed to send OTP email:", mailError);
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "OTP sent to your email successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/auth/verify-otp:
   *   post:
   *     summary: Verify the OTP code sent to email
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/VerifyOtpDto'
   *     responses:
   *       200:
   *         description: OTP verified successfully
   *       400:
   *         description: Invalid or expired OTP
   */
  @Post("/verify-otp")
  @HttpCode(StatusCodes.OK)
  async verifyOtp(@Body() body: VerifyOtpDto, @Res() res: any) {
    try {
      const email = (body.email || "").trim().toLowerCase();
      const otp = (body.otp || "").trim();

      if (!email || !EMAIL_REGEX.test(email)) {
        throw new BadRequestError("Please provide a valid email address");
      }

      const verificationRepo = AppDataSource.getMongoRepository(Verification);

      const verification = await verificationRepo.findOne({
        where: { identifier: email, otp, isVerified: false }
      });

      if (!verification) {
        throw new BadRequestError("Invalid or expired verification code");
      }

      if (new Date() > verification.expiresAt) {
        await verificationRepo.deleteMany({ identifier: email });
        throw new BadRequestError("Verification code has expired. Please request a new OTP.");
      }

      verification.isVerified = true;
      // Allow 10 minutes from verification to complete password reset
      const resetWindow = new Date();
      resetWindow.setMinutes(resetWindow.getMinutes() + 10);
      verification.expiresAt = resetWindow;
      await verificationRepo.save(verification);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "OTP verified successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/auth/reset-pin:
   *   post:
   *     summary: Reset admin password after OTP verification
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ResetPinDto'
   *     responses:
   *       200:
   *         description: Password reset successful
   *       400:
   *         description: Verification expired or missing
   */
  @Post("/reset-pin")
  @HttpCode(StatusCodes.OK)
  async resetPin(@Body() body: ResetPinDto, @Res() res: any) {
    try {
      const email = (body.email || "").trim().toLowerCase();
      const newPassword = body.newPassword || (body as any).newPin;

      if (!email || !EMAIL_REGEX.test(email)) {
        throw new BadRequestError("Please provide a valid email address");
      }

      if (!newPassword) {
        throw new BadRequestError("Please provide a new password");
      }
      if (!PASSWORD_POLICY_REGEX.test(newPassword)) {
        throw new BadRequestError("Password must be at least 8 characters long and include an uppercase letter, a number, and a special character");
      }

      const verificationRepo = AppDataSource.getMongoRepository(Verification);
      const verification = await verificationRepo.findOne({
        where: { identifier: email, isVerified: true }
      });

      if (!verification) {
        throw new BadRequestError("Please verify your email address first");
      }

      if (new Date() > verification.expiresAt) {
        await verificationRepo.deleteMany({ identifier: email });
        throw new BadRequestError("Verification expired. Please request a new OTP.");
      }

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: {
          email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
          isDeleted: false
        } as any
      });

      if (!user) {
        throw new BadRequestError("Admin User not found");
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.pin = hashedPassword;
      user.password = hashedPassword;
      await userRepo.save(user);

      // Permanently remove all verification records for this identifier after successful reset
      await verificationRepo.deleteMany({ identifier: email });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Password reset successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
