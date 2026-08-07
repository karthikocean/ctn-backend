import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  UseBefore,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Announcement, AnnouncementStatus, AnnouncementType } from "../../entity/Announcement";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateAnnouncementDto, UpdateAnnouncementDto } from "../../dto/admin/Announcement.dto";
import { Member } from "../../entity/Member";
import { AnnouncementBooking } from "../../entity/AnnouncementBooking";
import { notifyAnnouncementAudience } from "../../services/pushnotification.service";
import { StallBooking } from "../../entity/StallBooking";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";

@JsonController("/announcements")
export class AdminAnnouncementController {
  private announcementRepo = AppDataSource.getMongoRepository(Announcement);

  private validateStallConfig(data: any) {
    if (data.isOfflineStallExist) {
      if (!data.stallConfig) {
        throw new BadRequestError("Stall configuration is required when offline stalls are enabled");
      }
      const { totalStallCount, stalls } = data.stallConfig;
      if (totalStallCount === undefined || totalStallCount === null) {
        throw new BadRequestError("Total stall count is required");
      }
      if (totalStallCount < 0) {
        throw new BadRequestError("Total stall count cannot be negative");
      }
      if (!stalls || !Array.isArray(stalls)) {
        throw new BadRequestError("Stalls list is required and must be an array");
      }
      if (stalls.length !== totalStallCount) {
        throw new BadRequestError(`Total stall count (${totalStallCount}) does not match the actual number of configured stalls (${stalls.length})`);
      }
      const names = stalls.map((s: any) => s.name?.trim());
      if (names.some((n: any) => !n)) {
        throw new BadRequestError("All stalls must have a name");
      }
      // Check for duplicate stall names case-insensitive
      const lowercaseNames = names.map((n: string) => n.toLowerCase());
      const uniqueNames = new Set(lowercaseNames);
      if (uniqueNames.size !== lowercaseNames.length) {
        throw new BadRequestError("Stall names must be unique within an event");
      }
      if (stalls.some((s: any) => s.points === undefined || s.points === null || s.points === "" || isNaN(Number(s.points)))) {
        throw new BadRequestError("All stalls must have points configured");
      }
      if (stalls.some((s: any) => Number(s.points) < 0)) {
        throw new BadRequestError("Stall points cannot be negative");
      }
    }
  }

  /**
   * @swagger
   * /api/admin/announcements:
   *   post:
   *     summary: Create a new announcement (Admin)
   *     tags: [Admin Announcement]
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  @UseBefore(AuthMiddleware)
  async create(@Req() req: any, @Body() data: CreateAnnouncementDto, @Res() res: any) {
    try {
      this.validateStallConfig(data);
      // ✅ Check for unique title
      const existing = await this.announcementRepo.findOneBy({
        title: data.title,
        isDeleted: false
      });
      if (existing) throw new BadRequestError("An announcement with this title already exists");

      const announcement = new Announcement();
      Object.assign(announcement, data);

      if (data.regionIds && Array.isArray(data.regionIds)) {
        announcement.regionIds = data.regionIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
        if (announcement.regionIds.length > 0) {
          announcement.regionId = announcement.regionIds[0];
        } else {
          announcement.regionId = undefined;
        }
      } else {
        announcement.regionIds = [];
        if (data.regionId && ObjectId.isValid(data.regionId)) {
          announcement.regionId = new ObjectId(data.regionId);
          announcement.regionIds = [announcement.regionId];
        } else {
          announcement.regionId = undefined;
        }
      }

      if (data.scheduleDate) announcement.scheduleDate = new Date(data.scheduleDate);
      if (data.fromDate) announcement.fromDate = new Date(data.fromDate);
      if (data.toDate) announcement.toDate = new Date(data.toDate);
      if (data.date) announcement.date = new Date(data.date);

      if (data.announcementType === AnnouncementType.OTHERS) {
        if (!data.link || !data.link.trim()) {
          throw new BadRequestError("Link is required when announcement type is Others");
        }
        announcement.link = data.link;
        announcement.trainingId = undefined;
      } else if (data.announcementType === AnnouncementType.TRAINING) {
        if (!data.trainingId) {
          throw new BadRequestError("Training is required when announcement type is Training");
        }
        announcement.link = undefined;
        if (ObjectId.isValid(data.trainingId)) {
          announcement.trainingId = new ObjectId(data.trainingId);
        }
      } else {
        announcement.link = undefined;
        announcement.trainingId = undefined;
      }

      if (announcement.stallConfig && Array.isArray(announcement.stallConfig.stalls)) {
        announcement.stallConfig.stalls = announcement.stallConfig.stalls.map((s: any) => {
          let stallId: ObjectId;
          if (s._id && ObjectId.isValid(s._id)) {
            stallId = new ObjectId(s._id);
          } else {
            stallId = new ObjectId();
          }
          return {
            ...s,
            _id: stallId,
            points: Number(s.points)
          };
        });
      }

      announcement.isDeleted = false;
      announcement.status = data.status || AnnouncementStatus.DRAFT;

      announcement.createdBy = new ObjectId(req.user.userId);
      announcement.updatedBy = new ObjectId(req.user.userId);
      const saved = await this.announcementRepo.save(announcement);
      if (saved && data.status === AnnouncementStatus.PUBLISHED) {
        notifyAnnouncementAudience({
          announcementId: saved._id.toString(),
          title: saved.title || "New Announcement",
          content: saved.content || "",
          regionId: saved.regionId ? saved.regionId.toString() : undefined,
          regionIds: saved.regionIds ? saved.regionIds.map(id => id.toString()) : undefined,
          senderId: req.user.userId
        }).catch(err => console.error("Error notifying announcement audience on create:", err));
      }

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Announcement created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements:
   *   get:
   *     summary: List all announcements (Admin)
   *     tags: [Admin Announcement]
   */
  @Get("/")
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (search) {
        where.title = { $regex: search, $options: "i" };
      }

      const [announcements, total] = await this.announcementRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, announcements, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}:
   *   get:
   *     summary: Get single announcement details
   *     tags: [Admin Announcement]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      return res.status(StatusCodes.OK).json({
        success: true,
        data: announcement
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}:
   *   put:
   *     summary: Update announcement
   *     tags: [Admin Announcement]
   */
  @Put("/:id")
  @HttpCode(StatusCodes.OK)
  @UseBefore(AuthMiddleware)
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdateAnnouncementDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      this.validateStallConfig(data);

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      const previousStatus = announcement.status;
      Object.assign(announcement, data);

      if (data.regionIds && Array.isArray(data.regionIds)) {
        announcement.regionIds = data.regionIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
        if (announcement.regionIds.length > 0) {
          announcement.regionId = announcement.regionIds[0];
        } else {
          announcement.regionId = undefined;
        }
      } else if (data.regionIds === null) {
        announcement.regionIds = [];
        announcement.regionId = undefined;
      } else {
        if (data.regionId && ObjectId.isValid(data.regionId)) {
          announcement.regionId = new ObjectId(data.regionId);
          announcement.regionIds = [announcement.regionId];
        } else if (data.regionId === null || data.regionId === "") {
          announcement.regionId = undefined;
          announcement.regionIds = [];
        }
      }

      if (data.scheduleDate) announcement.scheduleDate = new Date(data.scheduleDate);
      if (data.fromDate) announcement.fromDate = new Date(data.fromDate);
      if (data.toDate) announcement.toDate = new Date(data.toDate);
      if (data.date) announcement.date = new Date(data.date);

      if (announcement.announcementType === AnnouncementType.OTHERS) {
        if (!announcement.link || !announcement.link.trim()) {
          throw new BadRequestError("Link is required when announcement type is Others");
        }
        announcement.trainingId = undefined;
      } else if (announcement.announcementType === AnnouncementType.TRAINING) {
        if (!data.trainingId && !announcement.trainingId) {
          throw new BadRequestError("Training is required when announcement type is Training");
        }
        announcement.link = undefined;
        if (data.trainingId && ObjectId.isValid(data.trainingId)) {
          announcement.trainingId = new ObjectId(data.trainingId);
        }
      } else if (data.announcementType) {
        announcement.link = undefined;
        announcement.trainingId = undefined;
      }

      if (announcement.stallConfig && Array.isArray(announcement.stallConfig.stalls)) {
        announcement.stallConfig.stalls = announcement.stallConfig.stalls.map((s: any) => {
          let stallId: ObjectId;
          if (s._id && ObjectId.isValid(s._id)) {
            stallId = new ObjectId(s._id);
          } else {
            stallId = new ObjectId();
          }
          return {
            ...s,
            _id: stallId,
            points: Number(s.points)
          };
        });
      }
      announcement.updatedBy = new ObjectId(req.user.userId);
      const saved = await this.announcementRepo.save(announcement);

      if (saved && saved.status === AnnouncementStatus.PUBLISHED && previousStatus !== AnnouncementStatus.PUBLISHED) {
        notifyAnnouncementAudience({
          announcementId: saved._id.toString(),
          title: saved.title || "New Announcement",
          content: saved.content || "",
          regionId: saved.regionId ? saved.regionId.toString() : undefined,
          regionIds: saved.regionIds ? saved.regionIds.map(id => id.toString()) : undefined,
          senderId: req.user.userId
        }).catch(err => console.error("Error notifying announcement audience on update:", err));
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Announcement updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}:
   *   delete:
   *     summary: Soft delete announcement
   *     tags: [Admin Announcement]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const announcement = await this.announcementRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      announcement.isDeleted = true;
      await this.announcementRepo.save(announcement);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Announcement deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/announcements/{id}/bookings:
   *   get:
   *     summary: Get all bookings (event and stalls) for a specific announcement
   *     tags: [Admin Announcement]
   */
  @Get("/:id/bookings")
  async getBookings(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const announcementOid = new ObjectId(id);

      const announcement = await this.announcementRepo.findOneBy({
        _id: announcementOid,
        isDeleted: false
      });

      if (!announcement) throw new NotFoundError("Announcement not found");

      // 1. Get event bookings
      const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);
      const eventBookings = await eventBookingRepo.find({
        where: {
          announcementId: announcementOid,
          status: "booked"
        }
      });

      // 2. Get stall bookings
      const stallBookingRepo = AppDataSource.getMongoRepository(StallBooking);
      const stallBookings = await stallBookingRepo.find({
        where: {
          announcementId: announcementOid,
          status: "booked"
        }
      });

      // 3. Get unique member IDs from both booking types
      const memberIds = Array.from(new Set([
        ...eventBookings.map(b => b.memberId.toString()),
        ...stallBookings.map(b => b.memberId.toString())
      ])).map(mId => new ObjectId(mId));

      const memberRepo = AppDataSource.getMongoRepository(Member);
      const members = memberIds.length > 0
        ? await memberRepo.find({
          where: {
            _id: { $in: memberIds },
            isDeleted: false
          } as any
        })
        : [];

      const memberMap = new Map<string, Member>(
        members.map(m => [m._id.toString(), m])
      );

      // 4. Build event bookings response
      const eventBookedMembers = eventBookings.map(b => {
        const member = memberMap.get(b.memberId.toString());
        return {
          bookingId: b._id,
          pointsSpent: b.pointsSpent,
          createdAt: b.createdAt,
          member: member ? {
            _id: member._id,
            fullName: member.fullName,
            mobileNumber: member.mobileNumber,
            email: member.email,
            profilePhoto: member.profilePhoto,
            businessName: member.businessName
          } : null
        };
      });

      // 5. Build stall bookings response
      const stallBookedMembers = stallBookings.map(b => {
        const member = memberMap.get(b.memberId.toString());
        const stallInfo = announcement.stallConfig?.stalls?.find(
          (s: any) => s._id?.toString() === b.stallId.toString()
        );

        return {
          bookingId: b._id,
          pointsSpent: b.pointsSpent,
          createdAt: b.createdAt,
          stall: stallInfo ? {
            _id: stallInfo._id,
            name: stallInfo.name,
            size: stallInfo.size,
            points: stallInfo.points
          } : {
            _id: b.stallId,
            name: "Unknown Stall",
            size: "",
            points: 0
          },
          member: member ? {
            _id: member._id,
            fullName: member.fullName,
            mobileNumber: member.mobileNumber,
            email: member.email,
            profilePhoto: member.profilePhoto,
            businessName: member.businessName
          } : null
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          announcementId: announcement._id,
          title: announcement.title,
          announcementType: announcement.announcementType,
          isOfflineStallExist: announcement.isOfflineStallExist,
          content: announcement.content,
          image: announcement.image,
          video: announcement.video,
          date: announcement.date,
          time: announcement.time,
          location: announcement.location,
          points: announcement.points,
          membersLimit: announcement.membersLimit,
          stallConfig: announcement.stallConfig,
          eventBookings: eventBookedMembers,
          stallBookings: stallBookedMembers
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
