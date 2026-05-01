import {
  JsonController,
  Post,
  Body,
  HttpCode,
  UnauthorizedError,
  Res
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { AppDataSource } from "../../data-source";
import { AdminUser } from "../../entity/AdminUser";
import { UserToken } from "../../entity/UserToken";

import { LoginDto } from "../../dto/admin/Auth.dto";
import handleErrorResponse from "../../utils/commonFunction";

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
            userId: user.id.toString(),
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
          roleId: user.roleId.toString()
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
