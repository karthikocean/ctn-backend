import { JsonController, Post, Body, Res, HttpCode } from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { AppDataSource } from "../../data-source";
import { Verification } from "../../entity/Verification";
import { MailService } from "../../services/mail.service";
import { SendOtpDto, VerifyOtpDto } from "../../dto/mobile/Verification.dto";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/verification")
export class VerificationController {
  private verificationRepo = AppDataSource.getMongoRepository(Verification);

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
   *             type: object
   *             properties:
   *               identifier:
   *                 type: string
   *                 example: user@example.com
   *               type:
   *                 type: string
   *                 enum: [email, phone]
   *                 example: email
   *     responses:
   *       200:
   *         description: OTP sent successfully
   */
  @Post("/send-otp")
  @HttpCode(StatusCodes.OK)
  async sendOtp(@Body() body: SendOtpDto, @Res() res: any) {
    try {
      const { identifier, type } = body;
      // Generate 4 digit OTP
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
        // TODO: Integrate SMS Service here
        console.log(`SMS OTP for ${identifier}: ${otp}`);
      }

      return res.status(StatusCodes.OK).json({
        message: `Verification code sent to ${type}`
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
   *             type: object
   *             properties:
   *               identifier:
   *                 type: string
   *                 example: user@example.com
   *               type:
   *                 type: string
   *                 enum: [email, phone]
   *                 example: email
   *               otp:
   *                 type: string
   *                 example: "1234"
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
      const { identifier, type, otp } = body;

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
