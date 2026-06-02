import {
  JsonController,
  Get,
  Post,
  Body,
  QueryParam,
  Res
} from "routing-controllers";
import { SendTestEmailDto } from "../../dto/admin/Common.dto";
import { MailService } from "../../services/mail.service";
import axios from "axios";
import handleErrorResponse from "../../utils/commonFunction";
import { AppDataSource } from "../../data-source";
import { BusinessRegion } from "../../entity/BusinessRegion";

@JsonController("/common")
export class AdminCommonController {

  /**
   * @swagger
   * /api/admin/common/verify-gst:
   *   get:
   *     summary: Verify GSTIN details
   *     tags: [Admin Common]
   *     parameters:
   *       - in: query
   *         name: gstin
   *         required: true
   *         schema:
   *           type: string
   *           example: "27AAACV9003N1Z2"
   *     responses:
   *       200:
   *         description: GST verification results
   */
  @Get("/verify-gst")
  async verifyGST(@QueryParam("gstin") gstin: string, @Res() res: any) {
    if (!gstin) {
      return res.status(400).json({ status: false, message: "GSTIN is required" });
    }

    // ✅ Basic GSTIN Format Validation (India)
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(gstin)) {
      return res.status(400).json({ status: false, message: "Invalid GSTIN format" });
    }

    try {
      const apiKey = process.env.GSTIN_CHECK_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ status: false, message: "GST API key not configured" });
      }

      const response = await axios.get(`https://sheet.gstincheck.co.in/check/${apiKey}/${gstin}`);

      if (response.data && response.data.flag) {
        const gstData = response.data.data;

        const formattedData = {
          gstNumber: gstData.gstin,
          businessName: gstData.tradeNam || gstData.lgnm,
          legalName: gstData.lgnm,
          gstStatus: gstData.sts,
          businessType: gstData.ctb,
          taxpayerType: gstData.dty,
          registrationDate: gstData.rgdt,
          address: gstData.pradr?.adr || "",
          pincode: gstData.pradr?.addr?.pncd || "",
          state: gstData.pradr?.addr?.stcd || "",
          district: gstData.pradr?.addr?.dst || "",
          natureOfBusiness: gstData.nba || []
        };
        return res.status(200).json({
          status: true,
          message: "GSTIN verified successfully",
          data: formattedData
        });
      } else {
        return res.status(400).json({
          status: false,
          message: response.data?.message || "GSTIN verification failed",
          error: response.data
        });
      }
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/business-region")
  async getBusinessRegion(@QueryParam("state") state: string, @QueryParam("city") city: string, @Res() res: any) {
    try {
      if (!state || !city) {
        return res.status(400).json({
          status: false,
          message: "status and city are required"
        });
      }

      const businessRegionRepository = AppDataSource.getMongoRepository(BusinessRegion);

      const businessRegion = await businessRegionRepository.findOne({
        where: {
          state: { $regex: new RegExp(`^${state}$`, "i") },
          city: { $regex: new RegExp(`^${city}$`, "i") },
          isDeleted: false
        }
      });

      return res.status(200).json({
        status: true,
        message: businessRegion
          ? "Business region found successfully"
          : "No matching business region found",
        data: {
          state,
          city,
          areas: businessRegion?.areas || []
        }
      });

    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/common/send-test-email:
   *   post:
   *     summary: Send a test email to verify configuration
   *     tags: [Admin Common]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: "test@example.com"
   *               subject:
   *                 type: string
   *                 example: "Test Email from Trusted Network"
   *               html:
   *                 type: string
   *                 example: "<h3>Test Email</h3><p>If you receive this, the email configuration is working perfectly!</p>"
   *     responses:
   *       200:
   *         description: Test email sent successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: "Test email sent successfully"
   *                 data:
   *                   type: object
   *       400:
   *         description: Invalid request parameters
   *       500:
   *         description: Failed to send email
   */
  @Post("/send-test-email")
  async sendTestEmail(@Body() body: SendTestEmailDto, @Res() res: any) {
    const { email, subject, html } = body;
    try {
      const emailSubject = subject || "Test Email - Trusted Network";
      const emailHtml = html || `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <h2 style="color: #14532D;">Trusted Network Email Configuration Test</h2>
          <p>Hello,</p>
          <p>This is a test email sent from the <strong>Trusted Network Backend</strong>.</p>
          <p>If you are reading this message, it means your ZeptoMail configuration is set up correctly and working successfully!</p>
          <hr style="border: 0; border-top: 1px solid #eee;" />
          <p style="color: #999; font-size: 12px;">Sent at: ${new Date().toLocaleString()}</p>
        </div>
      `;

      const result = await MailService.sendEmail(email, emailSubject, emailHtml);

      return res.status(200).json({
        status: true,
        message: "Test email sent successfully",
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

}
