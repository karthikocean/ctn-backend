import { IsString, IsNotEmpty, IsEnum } from "class-validator";
import { ConnectionStatus } from "../../entity/Connection";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateConnectionDto:
 *       type: object
 *       required:
 *         - receiverId
 *       properties:
 *         receiverId:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *     UpdateConnectionStatusDto:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [PENDING, ACCEPTED, REJECTED, BLOCKED, CANCELLED]
 *           example: "ACCEPTED"
 */

export class CreateConnectionDto {
  @IsString()
  @IsNotEmpty()
    receiverId!: string;
}

export class UpdateConnectionStatusDto {
  @IsEnum(ConnectionStatus)
  @IsNotEmpty()
    status!: ConnectionStatus;
}
