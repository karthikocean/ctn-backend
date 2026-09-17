import {
  JsonController,
  Post,
  Body,
  Res,
  HttpCode
} from "routing-controllers";
import { StatusCodes } from "http-status-codes";
import { AppDataSource } from "../../data-source";
import { IncompleteRegistration } from "../../entity/IncompleteRegistration";
import { CreateIncompleteRegistrationDto } from "../../dto/mobile/IncompleteRegistration.dto";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/incomplete-registrations")
export class MobileIncompleteRegistrationController {
  private repo = AppDataSource.getMongoRepository(IncompleteRegistration);

  /**
   * @swagger
   * /mobile-api/incomplete-registrations:
   *   post:
   *     summary: Save or update an incomplete registration entry
   *     description: >
   *       Called when a user begins the registration flow but does not complete it.
   *       If a non-deleted record already exists for the given mobileNumber, it is
   *       updated in place (upsert). No authentication is required.
   *     tags: [Mobile Incomplete Registrations]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateIncompleteRegistrationDto'
   *     responses:
   *       201:
   *         description: Record created or updated successfully
   *       400:
   *         description: Validation error
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() body: CreateIncompleteRegistrationDto, @Res() res: any) {
    try {
      const { fullName, mobileNumber, email, step, deviceInfo, fcmToken } = body;

      // Upsert: check for an existing incomplete registration for this mobile number
      let record = await this.repo.findOne({
        where: { mobileNumber, isDeleted: false }
      });

      if (record) {
        // Update existing record with latest data
        record.fullName = fullName;
        if (email !== undefined) record.email = email;
        if (step !== undefined) record.step = step;
        if (deviceInfo !== undefined) record.deviceInfo = deviceInfo;
        if (fcmToken !== undefined) record.fcmToken = fcmToken;
      } else {
        // Create new record
        record = this.repo.create({
          fullName,
          mobileNumber,
          email,
          step,
          deviceInfo,
          fcmToken,
          isDeleted: false
        });
      }

      const saved = await this.repo.save(record);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Incomplete registration saved successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
