/**
 * @swagger
 * components:
 *   schemas:
 *     LoginDto:
 *       type: object
 *       required:
 *         - phoneNumber
 *         - pin
 *       properties:
 *         phoneNumber:
 *           type: string
 *           example: "9876543210"
 *         pin:
 *           type: string
 *           example: "1234"
 */
import { IsString, IsNotEmpty, IsPhoneNumber, Length } from "class-validator";

export class LoginDto {
    @IsPhoneNumber("IN")
    @IsNotEmpty()
      phoneNumber!: string;

    @Length(4, 4)
    @IsString()
    @IsNotEmpty()
      pin!: string;
}
