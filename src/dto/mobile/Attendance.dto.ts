import { IsOptional, IsString, IsEnum } from "class-validator";
import { AttendanceStatus } from "../../entity/Attendance";

/**
 * @swagger
 * components:
 *   schemas:
 *     MarkAttendanceDto:
 *       type: object
 *       properties:
 *         eventId:
 *           type: string
 *           description: Announcement or Event ID (optional if provided in URL path)
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         announcementId:
 *           type: string
 *           description: Alias for eventId
 *           example: "60d5ecb8b392d7001f8e8e3a"
 *         memberId:
 *           type: string
 *           description: Member ID to mark attendance for (optional, defaults to authenticated member)
 *           example: "60d5ecb8b392d7001f8e8e3b"
 *         date:
 *           type: string
 *           format: date-time
 *           description: Date of attendance (optional, defaults to now)
 *           example: "2026-09-11T10:00:00.000Z"
 *         checkInTime:
 *           type: string
 *           description: Check-in time string
 *           example: "10:30 AM"
 *         status:
 *           type: string
 *           enum: [present, absent, late]
 *           default: present
 *         remarks:
 *           type: string
 *           description: Optional attendance notes
 *           example: "Checked in via mobile app"
 */
export class MarkAttendanceDto {
  @IsString()
  @IsOptional()
    eventId?: string;

  @IsString()
  @IsOptional()
    announcementId?: string;

  @IsString()
  @IsOptional()
    memberId?: string;

  @IsString()
  @IsOptional()
    date?: string;

  @IsString()
  @IsOptional()
    checkInTime?: string;

  @IsEnum(AttendanceStatus)
  @IsOptional()
    status?: AttendanceStatus;

  @IsString()
  @IsOptional()
    remarks?: string;
}
