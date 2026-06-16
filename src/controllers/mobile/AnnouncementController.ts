import {
  JsonController,
  Get,
  Post,
  Param,
  QueryParam,
  Body,
  Req,
  Res,
  UseBefore,
  NotFoundError,
  BadRequestError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Announcement, AnnouncementStatus, AnnouncementType } from "../../entity/Announcement";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { StallBooking } from "../../entity/StallBooking";
import { BookStallDto } from "../../dto/mobile/StallBooking.dto";
import { PointService } from "../../services/point.service";
import { Member } from "../../entity/Member";
import { AnnouncementBooking } from "../../entity/AnnouncementBooking";
import { validateModuleUsage } from "../../services/moduleUsage.service";

@JsonController("/announcements")
@UseBefore(MobileAuthMiddleware)
export class MobileAnnouncementController {
  private announcementRepo = AppDataSource.getMongoRepository(Announcement);

  /**
   * @swagger
   * /mobile-api/announcements/active:
   *   get:
   *     summary: Get all active announcements (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [Event, Online Stall, Offline stall]
   *     responses:
   *       200:
   *         description: List of active announcements
   */
  @Get("/active")
  async getActive(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("type") type: AnnouncementType,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const now = new Date();
      const where: any = {
        isDeleted: false,
        $or: [
          { status: AnnouncementStatus.PUBLISHED },
          {
            status: AnnouncementStatus.SCHEDULED,
            scheduleDate: { $lte: now }
          }
        ]
      };

      if (search) {
        where.title = { $regex: search, $options: "i" };
      }

      if (type) {
        where.announcementType = type;
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
   * /mobile-api/announcements/my-bookings:
   *   get:
   *     summary: Get list of logged in member's booked stalls (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/my-bookings")
  async getMyBookings(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const memberOid = new ObjectId(userId);

      const bookingRepo = AppDataSource.getMongoRepository(StallBooking);
      const bookings = await bookingRepo.find({
        where: {
          memberId: memberOid,
          status: "booked"
        },
        order: { createdAt: "DESC" }
      });

      if (bookings.length === 0) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: []
        });
      }

      const announcementIds = bookings.map(b => b.announcementId);
      const announcements = await this.announcementRepo.find({
        where: {
          _id: { $in: announcementIds }
        } as any
      });

      const annMap = new Map<string, Announcement>(
        announcements.map(a => [a._id.toString(), a])
      );

      const result = bookings.map(b => {
        const ann = annMap.get(b.announcementId.toString());
        const stallInfo = ann?.stallConfig?.stalls?.find(
          (s: any) => s._id?.toString() === b.stallId.toString()
        );

        return {
          bookingId: b._id,
          pointsSpent: b.pointsSpent,
          createdAt: b.createdAt,
          announcement: ann ? {
            _id: ann._id,
            title: ann.title,
            date: ann.date,
            time: ann.time,
            location: ann.location,
            image: ann.image
          } : null,
          stall: stallInfo ? {
            _id: stallInfo._id,
            name: stallInfo.name,
            size: stallInfo.size,
            points: stallInfo.points
          } : null
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/my-event-bookings:
   *   get:
   *     summary: Get list of logged in member's booked events (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/my-event-bookings")
  async getMyEventBookings(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const memberOid = new ObjectId(userId);

      const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);
      const bookings = await eventBookingRepo.find({
        where: {
          memberId: memberOid,
          status: "booked"
        },
        order: { createdAt: "DESC" }
      });

      if (bookings.length === 0) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: []
        });
      }

      const announcementIds = bookings.map(b => b.announcementId);
      const announcements = await this.announcementRepo.find({
        where: {
          _id: { $in: announcementIds }
        } as any
      });

      const annMap = new Map<string, Announcement>(
        announcements.map(a => [a._id.toString(), a])
      );

      const result = bookings.map(b => {
        const ann = annMap.get(b.announcementId.toString());

        return {
          bookingId: b._id,
          pointsSpent: b.pointsSpent,
          createdAt: b.createdAt,
          announcement: ann ? {
            _id: ann._id,
            title: ann.title,
            date: ann.date,
            time: ann.time,
            location: ann.location,
            image: ann.image
          } : null
        };
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/book-stall:
   *   post:
   *     summary: Book an offline event stall using points (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BookStallDto'
   *     responses:
   *       200:
   *         description: Stall booked successfully
   */
  @Post("/book-stall")
  async bookStall(@Req() req: any, @Body() body: BookStallDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const { announcementId, stallId } = body;

      if (!ObjectId.isValid(announcementId)) throw new BadRequestError("Invalid announcement ID");
      if (!ObjectId.isValid(stallId)) throw new BadRequestError("Invalid stall ID");

      const announcementOid = new ObjectId(announcementId);
      const stallOid = new ObjectId(stallId);
      const memberOid = new ObjectId(userId);

      const announcement = await this.announcementRepo.findOne({
        where: {
          _id: announcementOid,
          isDeleted: false
        }
      });

      if (!announcement) throw new NotFoundError("Announcement not found");
      if (!announcement.isOfflineStallExist) {
        throw new BadRequestError("Offline stalls are not enabled for this announcement");
      }

      const stalls = announcement.stallConfig?.stalls || [];
      const stall = stalls.find((s: any) => s._id?.toString() === stallId);
      if (!stall) {
        throw new NotFoundError("Stall not found in the announcement configuration");
      }

      // Check if stall already booked
      const bookingRepo = AppDataSource.getMongoRepository(StallBooking);
      const existingBooking = await bookingRepo.findOne({
        where: {
          announcementId: announcementOid,
          stallId: stallOid,
          status: "booked"
        }
      });

      if (existingBooking) {
        throw new BadRequestError("This stall has already been booked by another member");
      }

      // Validate Offline Stall capacity under the plan
      await validateModuleUsage(memberOid, "Offline Stall");

      // Check if user is already registered for the event announcement
      const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);
      const userEventBooking = await eventBookingRepo.findOne({
        where: {
          announcementId: announcementOid,
          memberId: memberOid,
          status: "booked"
        }
      });

      let eventPointsCost = 0;
      let needToBookEvent = false;

      if (!userEventBooking) {
        needToBookEvent = true;
        // Validate Event Booking capacity under the plan
        await validateModuleUsage(memberOid, "Event");
        eventPointsCost = announcement.points || 0;

        // Check registration limit for the event
        if (announcement.membersLimit > 0) {
          const bookedCount = await eventBookingRepo.count({
            where: {
              announcementId: announcementOid,
              status: "booked"
            }
          });

          if (bookedCount >= announcement.membersLimit) {
            throw new BadRequestError("The event is fully booked, so you cannot book a stall");
          }
        }
      }

      const pointService = new PointService();
      const totalPointsRequired = stall.points + eventPointsCost;
      let balance = await pointService.getMemberBalance(memberOid);

      if (balance < totalPointsRequired) {
        if (eventPointsCost > 0) {
          throw new BadRequestError(`Insufficient points. You have ${balance} points, but booking this stall requires ${stall.points} points and registering for the event requires ${eventPointsCost} points (total: ${totalPointsRequired}).`);
        } else {
          throw new BadRequestError(`Insufficient points. You have ${balance} points, but this stall requires ${stall.points} points.`);
        }
      }

      // 1. Book the event announcement if not already booked
      if (needToBookEvent) {
        const eventBooking = eventBookingRepo.create({
          announcementId: announcementOid,
          memberId: memberOid,
          pointsSpent: eventPointsCost,
          status: "booked"
        });
        await eventBookingRepo.save(eventBooking);

        // Deduct points for event booking if cost > 0
        if (eventPointsCost > 0) {
          const deduction = await pointService.deductPoints({
            memberId: memberOid,
            moduleName: "Event Booking",
            points: eventPointsCost,
            referenceId: eventBooking._id,
            actionType: "event_booking"
          });
          balance = deduction.balance;
        }
      }

      // 2. Book the Stall
      const booking = bookingRepo.create({
        announcementId: announcementOid,
        stallId: stallOid,
        memberId: memberOid,
        pointsSpent: stall.points,
        status: "booked"
      });
      await bookingRepo.save(booking);

      // Deduct points for stall booking
      const deduction = await pointService.deductPoints({
        memberId: memberOid,
        moduleName: "Stall Booking",
        points: stall.points,
        referenceId: booking._id,
        actionType: "stall_booking"
      });
      balance = deduction.balance;

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Stall booked successfully",
        data: {
          bookingId: booking._id,
          announcementId: booking.announcementId,
          stallId: booking.stallId,
          pointsSpent: booking.pointsSpent,
          balanceAfter: balance
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/{id}/book:
   *   post:
   *     summary: Book/register for an event announcement using points if configured (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Event booked successfully
   */
  @Post("/:id/book")
  async bookAnnouncement(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const userId = req.user.userId;
      console.log(userId, "userId");

      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid announcement ID");

      const announcementOid = new ObjectId(id);
      const memberOid = new ObjectId(userId);

      const announcement = await this.announcementRepo.findOne({
        where: {
          _id: announcementOid,
          isDeleted: false
        }
      });

      if (!announcement) throw new NotFoundError("Announcement not found");
      if (announcement.announcementType !== AnnouncementType.EVENT) {
        throw new BadRequestError("Only event announcements can be booked");
      }

      const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);

      // Check if already registered
      const existingBooking = await eventBookingRepo.findOne({
        where: {
          announcementId: announcementOid,
          memberId: memberOid,
          status: "booked"
        }
      });

      if (existingBooking) {
        throw new BadRequestError("You have already booked this event");
      }

      // Validate Event Booking capacity under the plan
      await validateModuleUsage(memberOid, "Event");

      // Check registration limits
      if (announcement.membersLimit > 0) {
        const bookedCount = await eventBookingRepo.count({
          where: {
            announcementId: announcementOid,
            status: "booked"
          }
        });

        if (bookedCount >= announcement.membersLimit) {
          throw new BadRequestError("This event is fully booked");
        }
      }

      const pointService = new PointService();
      let balance = await pointService.getMemberBalance(memberOid);
      const cost = announcement.points || 0;
      console.log(balance, "balance", cost, "cost");
      if (cost > 0) {
        if (balance < cost) {
          throw new BadRequestError(`Insufficient points. You have ${balance} points, but booking this event requires ${cost} points.`);
        }
      }

      // Save Booking
      const booking = eventBookingRepo.create({
        announcementId: announcementOid,
        memberId: memberOid,
        pointsSpent: cost,
        status: "booked"
      });
      await eventBookingRepo.save(booking);

      // Deduct points if cost > 0
      if (cost > 0) {
        const deduction = await pointService.deductPoints({
          memberId: memberOid,
          moduleName: "Event Booking",
          points: cost,
          referenceId: booking._id,
          actionType: "event_booking"
        });
        balance = deduction.balance;
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Event booked successfully",
        data: {
          bookingId: booking._id,
          announcementId: booking.announcementId,
          pointsSpent: booking.pointsSpent,
          balanceAfter: balance
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/{id}:
   *   get:
   *     summary: Get single active announcement details (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Announcement details
   *       404:
   *         description: Announcement not found
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Req() req: any, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const now = new Date();
      const announcement = await this.announcementRepo.findOne({
        where: {
          _id: new ObjectId(id),
          isDeleted: false,
          $or: [
            { status: AnnouncementStatus.PUBLISHED },
            {
              status: AnnouncementStatus.SCHEDULED,
              scheduleDate: { $lte: now }
            }
          ]
        }
      });

      if (!announcement) throw new NotFoundError("Announcement not found or not active");

      // Check offline stall booking statuses
      let stallConfig = announcement.stallConfig;
      if (announcement.isOfflineStallExist && stallConfig && Array.isArray(stallConfig.stalls)) {
        const bookingRepo = AppDataSource.getMongoRepository(StallBooking);
        const bookings = await bookingRepo.find({
          where: {
            announcementId: announcement._id,
            status: "booked"
          }
        });

        const memberRepo = AppDataSource.getMongoRepository(Member);
        const memberIds = bookings.map(b => b.memberId);
        const members = memberIds.length > 0
          ? await memberRepo.find({
            where: { _id: { $in: memberIds } } as any,
            select: ["_id", "fullName"] as any
          })
          : [];

        const memberMap = new Map<string, string>(
          members.map(m => [m._id.toString(), m.fullName])
        );

        const bookingMap = new Map<string, { memberId: string; memberName: string }>(
          bookings.map(b => [
            b.stallId.toString(),
            {
              memberId: b.memberId.toString(),
              memberName: memberMap.get(b.memberId.toString()) || "Unknown Member"
            }
          ])
        );

        const stallsWithBooking = stallConfig.stalls.map((s: any) => {
          const bookingInfo = bookingMap.get(s._id?.toString() || "");
          return {
            ...s,
            isBooked: !!bookingInfo,
            booking: bookingInfo || null
          };
        });

        stallConfig = {
          ...stallConfig,
          stalls: stallsWithBooking
        } as any;
      }

      // Check event booking details for the main announcement
      const userId = req.user?.userId;
      let isBooked = false;
      let bookedMembersCount = 0;

      if (announcement.announcementType === AnnouncementType.EVENT) {
        const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);
        bookedMembersCount = await eventBookingRepo.count({
          where: {
            announcementId: announcement._id,
            status: "booked"
          }
        });

        if (userId) {
          const userBooking = await eventBookingRepo.findOne({
            where: {
              announcementId: announcement._id,
              memberId: new ObjectId(userId),
              status: "booked"
            }
          });
          isBooked = !!userBooking;
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...announcement,
          stallConfig,
          isBooked,
          bookedMembersCount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
