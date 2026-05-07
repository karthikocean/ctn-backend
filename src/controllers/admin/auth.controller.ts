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

import { LoginDto, ChangePinDto } from "../../dto/admin/Auth.dto";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { UseBefore } from "routing-controllers";

@JsonController("/auth")
export class AuthController {

    /**
     * @swagger
     * /api/auth/login:
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
        throw new UnauthorizedError("Invalid credentials");
      }

      const isMatch = await bcrypt.compare(pin, user.pin);
      if (!isMatch) {
        throw new UnauthorizedError("Invalid credentials");
      }

      // Check if token already exists in user_tokens collection
      const tokenRepo = AppDataSource.getMongoRepository(UserToken);
      const existingToken = await tokenRepo.findOne({
        where: { userId: user.id }
      });

      let finalToken: string;

      if (existingToken) {
        finalToken = existingToken.token;
      } else {
        // Generate new token if not exists
        finalToken = jwt.sign(
          {
            id: user.id.toString(),
            roleId: user.roleId.toString()
          },
            process.env.JWT_SECRET as string,
            {
              expiresIn: "1d"
            }
        );

        const userToken = new UserToken();
        userToken.userId = user.id;
        userToken.token = finalToken;
        await tokenRepo.save(userToken);
      }

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
   * /api/auth/change-pin:
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
}
