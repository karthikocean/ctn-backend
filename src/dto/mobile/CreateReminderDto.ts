import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsArray } from "class-validator";
import { RepeatType, NotifyBy } from "../../entity/Reminder";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateReminderDto:
 *       type: object
 *       required:
 *         - title
 *         - module
 *         - reminderDate
 *         - reminderTime
 *         - repeatType
 *         - repeatInterval
 *         - notifyBy
 *         - recipients
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
 */
export class CreateReminderDto {
  @IsString()
  @IsNotEmpty()
    title!: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsString()
  @IsNotEmpty()
    module!: string;

  @IsString()
  @IsOptional()
    moduleId?: string;

  @IsString()
  @IsNotEmpty()
    reminderDate!: string;

  @IsString()
  @IsNotEmpty()
    reminderTime!: string;

  @IsEnum(RepeatType)
  @IsNotEmpty()
    repeatType!: RepeatType;

  @IsNumber()
  @IsNotEmpty()
    repeatInterval!: number;

  @IsArray()
  @IsEnum(NotifyBy, { each: true })
  @IsNotEmpty()
    notifyBy!: NotifyBy[];

}
