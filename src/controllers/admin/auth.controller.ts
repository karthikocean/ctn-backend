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
import { sendForgotPinSMS } from "../../utils/sms";
import { Role } from "../../entity/Role.Permission";
import { Franchise, FranchiseStatus } from "../../entity/Franchise";

@JsonController("/auth")
export class AuthController {

  /**
   * @swagger
   * /api/admin/auth/login:
   *   post:
   *     summary: Admin login using phone number and PIN
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
   *         description: Missing fields
   *       401:
   *         description: Invalid credentials
   */
  @Post("/login")
  @HttpCode(StatusCodes.OK)
  async login(@Body() body: LoginDto, @Res() res: any) {
    try {
      const { phoneNumber, pin } = body;

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: { phoneNumber }
      });

      if (!user) {
        throw new UnauthorizedError("User Account not found!!");
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
      const isMatch = await bcrypt.compare(pin, user.pin);
      if (!isMatch) {
        throw new UnauthorizedError("User Pin is incorrect!!");
      }

      // Check if the account is active
      if (!user.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact admin.");
      }

      // Generate new token and save to DB (allows multi-device login sessions for admin users)
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
   *     summary: Change admin user PIN
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
   *         description: PIN changed successfully
   *       400:
   *         description: Invalid old PIN
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

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: { _id: new ObjectId(userId) }
      });

      if (!user) {
        throw new UnauthorizedError("User not found");
      }

      const isMatch = await bcrypt.compare(oldPin, user.pin);
      if (!isMatch) {
        throw new BadRequestError("Invalid old PIN");
      }

      user.pin = await bcrypt.hash(newPin, 10);
      await userRepo.save(user);

      return res.status(StatusCodes.OK).json({
        message: "PIN changed successfully"
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
   *     summary: Send OTP for admin password/PIN reset
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
   *         description: User Account not found or bad request
   */
  @Post("/forgot-pin")
  @HttpCode(StatusCodes.OK)
  async forgotPin(@Body() body: ForgotPinDto, @Res() res: any) {
    try {
      const { phoneNumber } = body;

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: { phoneNumber }
      });

      if (!user) {
        throw new BadRequestError("Admin User not found with this phone number!!");
      }

      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 2);

      const verificationRepo = AppDataSource.getMongoRepository(Verification);
      let verification = await verificationRepo.findOne({
        where: { identifier: phoneNumber, type: "phone", isVerified: false }
      });

      if (verification) {
        verification.otp = otp;
        verification.expiresAt = expiresAt;
      } else {
        verification = verificationRepo.create({
          identifier: phoneNumber,
          type: "phone",
          otp,
          expiresAt,
          isVerified: false
        });
      }

      await verificationRepo.save(verification);
      await sendForgotPinSMS(phoneNumber, otp);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "OTP sent successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/auth/verify-otp:
   *   post:
   *     summary: Verify the OTP code
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
      const { phoneNumber, otp } = body;

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: { phoneNumber }
      });

      if (!user) {
        throw new BadRequestError("Admin User not found!!");
      }

      const verificationRepo = AppDataSource.getMongoRepository(Verification);

      const verification = await verificationRepo.findOne({
        where: { identifier: phoneNumber, type: "phone", otp, isVerified: false }
      });

      if (!verification) {
        throw new BadRequestError("Invalid or expired verification code");
      }

      if (new Date() > verification.expiresAt) {
        throw new BadRequestError("Verification code has expired");
      }

      verification.isVerified = true;
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
   *     summary: Reset admin PIN after OTP verification
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ResetPinDto'
   *     responses:
   *       200:
   *         description: PIN reset successful
   *       400:
   *         description: Verification expired or missing
   */
  @Post("/reset-pin")
  @HttpCode(StatusCodes.OK)
  async resetPin(@Body() body: ResetPinDto, @Res() res: any) {
    try {
      const { phoneNumber, newPin } = body;

      const verificationRepo = AppDataSource.getMongoRepository(Verification);
      const verification = await verificationRepo.findOne({
        where: { identifier: phoneNumber, type: "phone", isVerified: true },
        order: { createdAt: "DESC" }
      });

      if (!verification) {
        throw new BadRequestError("Please verify your phone number first");
      }

      const twoMinutesAgo = new Date();
      twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() - 2);
      if (verification.createdAt < twoMinutesAgo) {
        throw new BadRequestError("Verification expired. Please request a new OTP.");
      }

      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const user = await userRepo.findOne({
        where: { phoneNumber }
      });

      if (!user) {
        throw new BadRequestError("Admin User not found");
      }

      user.pin = await bcrypt.hash(newPin, 10);
      await userRepo.save(user);

      // Consume the verification
      verification.isVerified = false;
      await verificationRepo.save(verification);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "PIN reset successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}

