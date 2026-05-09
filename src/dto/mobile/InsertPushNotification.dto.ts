import {
  IsString,
  IsNotEmpty,
  IsOptional,
} from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     InsertPushNotificationDto:
 *       type: object
 *       required:
 *         - token
 *         - subject
 *         - moduleName
 *         - content
 *         - receiverId
 *       properties:
 *         token:
 *           type: string
 *           example: "fcm_device_token"
 *         subject:
 *           type: string
 *           example: "Work Order Assigned"
 *         moduleId:
 *           type: string
 *           example: "6891a4c5f7c12d001245abc"
 *         moduleName:
 *           type: string
 *           example: "WORKORDER"
 *         content:
 *           type: string
 *           example: "New work order assigned to you"
 *         receiverId:
 *           type: string
 *           example: "6891a4c5f7c12d001245def"
 *         senderId:
 *           type: string
 *           example: "6891a4c5f7c12d001245xyz"
 */

export class InsertPushNotificationDto {
    @IsString()
    @IsNotEmpty()
      token!: string;

    @IsString()
    @IsNotEmpty()
      subject!: string;

    @IsString()
    @IsOptional()
      moduleId?: string;

    @IsString()
    @IsNotEmpty()
      moduleName!: string;

    @IsString()
    @IsNotEmpty()
      content!: string;

    @IsString()
    @IsNotEmpty()
      receiverId!: string;

    @IsString()
    @IsOptional()
      senderId?: string;
}
