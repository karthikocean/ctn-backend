import { IsNotEmpty, IsString } from "class-validator";

/**
 * @swagger
 * components:
 *   schemas:
 *     BookStallDto:
 *       type: object
 *       required:
 *         - announcementId
 *         - stallId
 *       properties:
 *         announcementId:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         stallId:
 *           type: string
 *           example: "60d5ecb8b392d7001f8e8e3b"
 */
export class BookStallDto {
  @IsString()
  @IsNotEmpty()
    announcementId!: string;

  @IsString()
  @IsNotEmpty()
    stallId!: string;
}
