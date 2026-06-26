import { IsString, IsOptional, IsEnum, IsNumber, IsArray, IsMongoId, IsBoolean } from "class-validator";
import { RepeatType, NotifyBy, ReminderStatus } from "../../entity/Reminder";

/**
 * @swagger
 * components:
 *   schemas:
 *     UpdateReminderDto:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           example: "Call Client"
 *         description:
 *           type: string
 *           example: "Follow up about the contract"
 *         module:
 *           type: string
 *           example: "EVENT"
 *         moduleId:
 *           type: string
 *           example: "6a3e56f9c93671c42134be40"
 *         reminderDate:
 *           type: string
 *           format: date-time
 *           example: "2026-06-27T10:30:00.000Z"
 *         reminderTime:
 *           type: string
 *           example: "10:30 AM"
 *         repeatType:
 *           type: string
 *           enum: [Once, Daily, Weekly, Monthly, Yearly]
 *           example: "Daily"
 *         repeatInterval:
 *           type: number
 *           example: 1
 *         notifyBy:
 *           type: array
 *           items:
 *             type: string
 *             enum: [APP, EMAIL, SMS, WHATSAPP, PUSH]
 *           example: ["PUSH", "EMAIL"]
 *         recipients:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a3e56f9c93671c42134be3e"]
 *         status:
 *           type: string
 *           enum: [Pending, Completed, Cancelled]
 *           example: "Completed"
 *         isActive:
 *           type: boolean
 *           example: true
 */
export class UpdateReminderDto {
  @IsString()
  @IsOptional()
    title?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsString()
  @IsOptional()
    module?: string;

  @IsString()
  @IsOptional()
    moduleId?: string;

  @IsString()
  @IsOptional()
    reminderDate?: string;

  @IsString()
  @IsOptional()
    reminderTime?: string;

  @IsEnum(RepeatType)
  @IsOptional()
    repeatType?: RepeatType;

  @IsNumber()
  @IsOptional()
    repeatInterval?: number;

  @IsArray()
  @IsEnum(NotifyBy, { each: true })
  @IsOptional()
    notifyBy?: NotifyBy[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    recipients?: string[];

  @IsEnum(ReminderStatus)
  @IsOptional()
    status?: ReminderStatus;

  @IsBoolean()
  @IsOptional()
    isActive?: boolean;
}
