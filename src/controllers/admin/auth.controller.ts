import {
    JsonController,
    Post,
    Body,
    HttpCode,
    BadRequestError,
    UnauthorizedError
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { AppDataSource } from "../../data-source";
import { AdminUser } from "../../entity/AdminUser";

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
     *             type: object
     *             required:
     *               - phoneNumber
     *               - pin
     *             properties:
     *               phoneNumber:
     *                 type: string
     *                 example: "9876543210"
     *               pin:
     *                 type: string
     *                 example: "1234"
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
    async login(@Body() body: any) {
        const { phoneNumber, pin } = body;

        // 🔴 Validate input
        if (!phoneNumber || !pin) {
            throw new BadRequestError("Phone number and PIN are required");
        }

        // 🔍 Find user
        const userRepo = AppDataSource.getMongoRepository(AdminUser);
        const user = await userRepo.findOne({
            where: { phoneNumber }
        });

        if (!user) {
            throw new UnauthorizedError("User not found!");
        }

        // 🔐 Compare PIN
        const isMatch = await bcrypt.compare(pin, user.pin);
        if (!isMatch) {
            throw new UnauthorizedError("Invalid credentials");
        }

        // 🎟️ Generate JWT
        const token = jwt.sign(
            {
                userId: user.id,
                phoneNumber: user.phoneNumber,
                role: user.roleId
            },
            process.env.JWT_SECRET as string,
            {
                expiresIn: "1d"
            }
        );

        // ✅ Response
        return {
            message: "Login successful",
            token,
            user: {
                // id: user.,
                phoneNumber: user.phoneNumber,
                name: user.name
            }
        };
    }
}