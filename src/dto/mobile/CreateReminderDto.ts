import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum } from "class-validator";
import { ReminderRecipientType } from "../../entity/Reminder";
// import { RepeatType, NotifyBy } from "../../entity/Reminder";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateReminderDto:
 *       type: object
 *       required:
 *         - title
 *         - reminderDate
 *         - reminderTime
 *         - repeatInterval
 *       properties:
 *         title:
 *           type: string
 *           example: "Call Client"
 *         description:
 *           type: string
 *           example: "Follow up about the contract"
 *         reminderDate:
 *           type: string
 *           format: date-time
 *           example: "2026-06-27T10:30:00.000Z"
 *         reminderTime:
 *           type: string
 *           example: "10:30 AM"
 *         repeatInterval:
 *           type: number
 *           example: 1
 */
export class CreateReminderDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  // @IsString()
  // @IsNotEmpty()
  //   module!: string;

  // @IsString()
  // @IsOptional()
  //   moduleId?: string;

  @IsString()
  @IsNotEmpty()
  reminderDate!: string;

  @IsString()
  @IsNotEmpty()
  reminderTime!: string;

  @IsEnum(ReminderRecipientType)
  @IsNotEmpty()
  recipientType!: ReminderRecipientType;

  @IsNumber()
  @IsNotEmpty()
  repeatInterval!: number;

  // @IsArray()
  // @IsEnum(NotifyBy, { each: true })
  // @IsNotEmpty()
  //   notifyBy!: NotifyBy[];
}
