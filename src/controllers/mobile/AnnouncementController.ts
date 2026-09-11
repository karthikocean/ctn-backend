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
import { Member, MemberStatus } from "../../entity/Member";
import { AnnouncementBooking } from "../../entity/AnnouncementBooking";
import { validateModuleUsage } from "../../services/moduleUsage.service";
import { Attendance, AttendanceStatus } from "../../entity/Attendance";
import { MarkAttendanceDto } from "../../dto/mobile/Attendance.dto";
import { PointConfigType } from "../../entity/PointConfig";
import { EventRazorpayService } from "../../services/eventRazorpay.service";
import {
  BuyEventAnnouncementDto,
  VerifyEventPaymentDto,
  CancelEventPaymentDto
} from "../../dto/mobile/AnnouncementPayment.dto";

@JsonController("/announcements")
@UseBefore(MobileAuthMiddleware)
export class MobileAnnouncementController {
  private announcementRepo = AppDataSource.getMongoRepository(Announcement);
  private eventRazorpayService = new EventRazorpayService();

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
    @Res() res: any,
    @Req() req: any
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
        ],
        $and: [
          {
            $or: [
              { toDate: { $gte: now } },
              { toDate: null },
              { toDate: { $exists: false } },
              {
                $and: [
                  { toDate: { $exists: false } },
                  { date: { $gte: now } }
                ]
              },
              {
                $and: [
                  { toDate: { $exists: false } },
                  { date: { $exists: false } }
                ]
              }
            ]
          }
        ]
      };

      const memberRepo = AppDataSource.getMongoRepository(Member);
      const member = await memberRepo.findOneBy({ _id: new ObjectId(req.user.userId) });
      const memberRegionId = member?.businessRegion;

      const regionConditions: any[] = [
        { regionId: { $exists: false } },
        { regionId: null },
        { regionIds: { $exists: false } },
        { regionIds: null },
        { regionIds: [] },
        { regionIds: { $size: 0 } }
      ];

      if (memberRegionId) {
        const memberRegionStr = memberRegionId.toString();
        regionConditions.push({ regionId: memberRegionStr });
        regionConditions.push({ regionIds: memberRegionStr });
        if (ObjectId.isValid(memberRegionStr)) {
          const memberRegionOid = new ObjectId(memberRegionStr);
          regionConditions.push({ regionId: memberRegionOid });
          regionConditions.push({ regionIds: memberRegionOid });
        }
      }

      where.$and.push({ $or: regionConditions });

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

      const bookingRepo = AppDataSource.getMongoRepository(StallBooking);
      const announcementIds = announcements.map(a => a._id);
      const bookings = await bookingRepo.find({
        where: {
          announcementId: { $in: announcementIds },
          status: "booked"
        } as any
      });

      const bookedStallIds = new Set(bookings.map(b => b.stallId.toString()));

      announcements.forEach(ann => {
        if (ann.isOfflineStallExist && ann.stallConfig && Array.isArray(ann.stallConfig.stalls)) {
          ann.stallConfig.stalls = ann.stallConfig.stalls.map((s: any) => {
            return {
              ...s,
              isBooked: bookedStallIds.has(s._id?.toString() || "")
            };
          });
        }
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
   * /mobile-api/announcements/my-attendances:
   *   get:
   *     summary: Get list of logged in member's attended announcement meetings (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   */
  @Get("/my-attendances")
  async getMyAttendances(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const memberOid = new ObjectId(userId);

      const attendanceRepo = AppDataSource.getMongoRepository(Attendance);
      const attendances = await attendanceRepo.find({
        where: {
          memberId: memberOid
        },
        order: { date: "DESC", createdAt: "DESC" }
      });

      if (attendances.length === 0) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: []
        });
      }

      const announcementIds = Array.from(
        new Set(attendances.map(a => (a.eventId || a.announcementId)?.toString()).filter(Boolean))
      ).map(id => new ObjectId(id));

      const announcements = await this.announcementRepo.find({
        where: {
          _id: { $in: announcementIds }
        } as any
      });

      const annMap = new Map<string, Announcement>(
        announcements.map(a => [a._id.toString(), a])
      );

      const result = attendances.map(att => {
        const targetId = (att.eventId || att.announcementId)?.toString();
        const ann = targetId ? annMap.get(targetId) : null;

        return {
          attendanceId: att._id,
          eventId: att.eventId,
          announcementId: att.announcementId,
          bookingId: att.bookingId,
          date: att.date,
          checkInTime: att.checkInTime,
          status: att.status,
          remarks: att.remarks,
          createdAt: att.createdAt,
          announcement: ann ? {
            _id: ann._id,
            title: ann.title,
            announcementType: ann.announcementType,
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
        eventPointsCost = announcement.points || 0;

        // Check registration limit for the event
        if (announcement.membersLimit > 0) {
          const bookedCount = await eventBookingRepo.count({
            announcementId: announcementOid,
            status: "booked"
          } as any);

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
          throw new BadRequestError(`Insufficient points. Need ${totalPointsRequired} pts (stall: ${stall.points} + event: ${eventPointsCost}), you have ${balance}.`);
        } else {
          throw new BadRequestError(`Insufficient points. Need ${stall.points} pts, you have ${balance}.`);
        }
      }

      // Validate Offline Stall capacity under the plan
      await validateModuleUsage(memberOid, "Offline Stall");
      if (needToBookEvent) {
        await validateModuleUsage(memberOid, "Event");
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
   * /mobile-api/announcements/buy:
   *   post:
   *     summary: Create Razorpay checkout order for paid event booking via body (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BuyEventAnnouncementDto'
   *     responses:
   *       200:
   *         description: Razorpay order created for event booking
   */
  @Post("/buy")
  async buyEventAnnouncementViaBody(@Req() req: any, @Body() body: BuyEventAnnouncementDto, @Res() res: any) {
    try {
      const announcementId = body?.announcementId;
      if (!announcementId) throw new BadRequestError("announcementId is required");
      const data = await this.eventRazorpayService.initiateBuy(req.user.userId, announcementId);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Razorpay payment transaction initiated.",
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/verify-payment:
   *   post:
   *     summary: Verify Razorpay payment signature and complete event booking (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/VerifyEventPaymentDto'
   *     responses:
   *       200:
   *         description: Payment verified and event booked successfully
   */
  @Post("/verify-payment")
  async verifyEventPayment(@Req() req: any, @Body() body: VerifyEventPaymentDto, @Res() res: any) {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
      const result = await this.eventRazorpayService.verifyPayment(
        req.user.userId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );
      return res.status(StatusCodes.OK).json(result);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/cancel-payment:
   *   post:
   *     summary: Cancel a pending Razorpay payment for event booking (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CancelEventPaymentDto'
   *     responses:
   *       200:
   *         description: Payment transaction cancelled successfully
   */
  @Post("/cancel-payment")
  async cancelEventPayment(@Req() req: any, @Body() body: CancelEventPaymentDto, @Res() res: any) {
    try {
      const { razorpayOrderId } = body;
      const result = await this.eventRazorpayService.cancelPayment(
        req.user.userId,
        razorpayOrderId
      );
      return res.status(StatusCodes.OK).json(result);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/{id}/buy:
   *   post:
   *     summary: Create Razorpay checkout order for paid event booking via path param (Mobile)
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
   *         description: Razorpay order created for event booking
   */
  @Post("/:id/buy")
  async buyEventAnnouncement(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      const data = await this.eventRazorpayService.initiateBuy(req.user.userId, id);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Razorpay payment transaction initiated.",
        data
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

      // Check registration limits
      if (announcement.membersLimit > 0) {
        const bookedCount = await eventBookingRepo.count({
          announcementId: announcementOid,
          status: "booked"
        } as any);

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
          throw new BadRequestError(`Insufficient points. Need ${cost} pts, you have ${balance}.`);
        }
      }

      // Validate Event Booking capacity under the plan
      await validateModuleUsage(memberOid, "Event");

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
          announcementId: announcement._id,
          status: "booked"
        } as any);

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

      // Check attendance details
      let isAttended = false;
      let attendedMembersCount = 0;
      const attendanceRepo = AppDataSource.getMongoRepository(Attendance);
      attendedMembersCount = await attendanceRepo.count({
        $or: [
          { eventId: announcement._id },
          { announcementId: announcement._id }
        ]
      } as any);

      if (userId) {
        const userAttendance = await attendanceRepo.findOne({
          where: {
            $or: [
              { eventId: announcement._id, memberId: new ObjectId(userId) },
              { announcementId: announcement._id, memberId: new ObjectId(userId) }
            ]
          } as any
        });
        isAttended = !!userAttendance;
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...announcement,
          stallConfig,
          isBooked,
          bookedMembersCount,
          isAttended,
          attendedMembersCount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * Helper method to process attendance marking with proper booking checks
   */
  private async processMarkAttendance(
    targetAnnouncementId: string,
    targetMemberId: string | undefined,
    currentUserId: string,
    body: MarkAttendanceDto | undefined,
    res: any
  ) {
    if (!ObjectId.isValid(targetAnnouncementId)) {
      throw new BadRequestError("Invalid announcement ID");
    }

    const effectiveMemberIdStr = targetMemberId || currentUserId;
    if (!ObjectId.isValid(effectiveMemberIdStr)) {
      throw new BadRequestError("Invalid member ID");
    }

    const announcementOid = new ObjectId(targetAnnouncementId);
    const memberOid = new ObjectId(effectiveMemberIdStr);
    const markerOid = new ObjectId(currentUserId);

    // 1. Verify announcement meeting exists and is active / not deleted
    const announcement = await this.announcementRepo.findOne({
      where: {
        _id: announcementOid,
        isDeleted: false
      }
    });

    if (!announcement) {
      throw new NotFoundError("Announcement meeting not found");
    }

    // 2. Verify member exists and is active
    const memberRepo = AppDataSource.getMongoRepository(Member);
    const member = await memberRepo.findOne({
      where: {
        _id: memberOid,
        isDeleted: false
      }
    });

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    if (member.status === MemberStatus.INACTIVE || member.status === MemberStatus.BLOCKED) {
      throw new BadRequestError("Member account is inactive or blocked");
    }

    // 3. Proper check: verify member has booked the meeting
    const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);
    const eventBooking = await eventBookingRepo.findOne({
      where: {
        announcementId: announcementOid,
        memberId: memberOid,
        status: "booked"
      }
    });

    let bookingId: ObjectId | undefined = eventBooking?._id;

    if (!eventBooking) {
      // Also check stall bookings if member booked via offline stall
      const stallBookingRepo = AppDataSource.getMongoRepository(StallBooking);
      const stallBooking = await stallBookingRepo.findOne({
        where: {
          announcementId: announcementOid,
          memberId: memberOid,
          status: "booked"
        }
      });

      if (stallBooking) {
        bookingId = stallBooking._id;
      }
    }

    if (!bookingId) {
      throw new BadRequestError(
        "Member has not booked this announcement meeting. Attendance can only be recorded for booked members."
      );
    }

    // 4. Duplicate attendance check
    const attendanceRepo = AppDataSource.getMongoRepository(Attendance);
    const existingAttendance = await attendanceRepo.findOne({
      where: {
        $or: [
          { eventId: announcementOid, memberId: memberOid },
          { announcementId: announcementOid, memberId: memberOid }
        ]
      } as any
    });

    if (existingAttendance) {
      throw new BadRequestError("Attendance has already been marked for this meeting");
    }

    // 5. Build and save attendance record
    const attendanceDate = body?.date ? new Date(body.date) : new Date();
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    const checkInTime = body?.checkInTime || timeFormatter.format(now);

    const attendance = attendanceRepo.create({
      memberId: memberOid,
      eventId: announcementOid,
      announcementId: announcementOid,
      bookingId: bookingId,
      date: attendanceDate,
      checkInTime: checkInTime,
      status: body?.status || AttendanceStatus.PRESENT,
      markedBy: markerOid,
      remarks: body?.remarks || ""
    });

    const savedAttendance = await attendanceRepo.save(attendance);

    // 6. Optionally award points for attendance if configured in PointConfig
    try {
      const pointService = new PointService();
      await pointService.awardPoints({
        memberId: memberOid,
        moduleName: "Attendance",
        type: PointConfigType.RESPONSE,
        referenceId: savedAttendance._id
      });
    } catch {
      // Optional point awarding does not fail attendance marking
    }

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Attendance marked successfully",
      data: {
        attendanceId: savedAttendance._id,
        memberId: savedAttendance.memberId,
        eventId: savedAttendance.eventId,
        announcementId: savedAttendance.announcementId,
        bookingId: savedAttendance.bookingId,
        date: savedAttendance.date,
        checkInTime: savedAttendance.checkInTime,
        status: savedAttendance.status,
        remarks: savedAttendance.remarks,
        createdAt: savedAttendance.createdAt
      }
    });
  }

  /**
   * @swagger
   * /mobile-api/announcements/attendance:
   *   post:
   *     summary: Mark attendance for an announcement meeting via body payload (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/MarkAttendanceDto'
   *     responses:
   *       201:
   *         description: Attendance marked successfully
   *       400:
   *         description: Member not booked or duplicate attendance
   */
  @Post("/attendance")
  async markAttendance(@Req() req: any, @Body() body: MarkAttendanceDto, @Res() res: any) {
    try {
      const targetAnnouncementId = body?.eventId || body?.announcementId;
      if (!targetAnnouncementId) {
        throw new BadRequestError("eventId is required");
      }

      return await this.processMarkAttendance(
        targetAnnouncementId,
        body?.memberId,
        req.user.userId,
        body,
        res
      );
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/{id}/attendance:
   *   get:
   *     summary: Check attendance status for logged-in member for an announcement meeting (Mobile)
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
   *         description: Attendance and booking status
   */
  @Get("/:id/attendance")
  async getAttendanceStatus(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid announcement ID");
      const userId = req.user.userId;
      const announcementOid = new ObjectId(id);
      const memberOid = new ObjectId(userId);

      const eventBookingRepo = AppDataSource.getMongoRepository(AnnouncementBooking);
      const stallBookingRepo = AppDataSource.getMongoRepository(StallBooking);
      const attendanceRepo = AppDataSource.getMongoRepository(Attendance);

      const [eventBooking, stallBooking, attendance] = await Promise.all([
        eventBookingRepo.findOne({
          where: { announcementId: announcementOid, memberId: memberOid, status: "booked" }
        }),
        stallBookingRepo.findOne({
          where: { announcementId: announcementOid, memberId: memberOid, status: "booked" }
        }),
        attendanceRepo.findOne({
          where: {
            $or: [
              { eventId: announcementOid, memberId: memberOid },
              { announcementId: announcementOid, memberId: memberOid }
            ]
          } as any
        })
      ]);

      const isBooked = !!(eventBooking || stallBooking);
      const isAttended = !!attendance;

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          announcementId: announcementOid,
          memberId: memberOid,
          isBooked,
          isAttended,
          booking: eventBooking || stallBooking || null,
          attendance: attendance ? {
            attendanceId: attendance._id,
            eventId: attendance.eventId,
            date: attendance.date,
            checkInTime: attendance.checkInTime,
            status: attendance.status,
            remarks: attendance.remarks,
            createdAt: attendance.createdAt
          } : null
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/announcements/{id}/attendees:
   *   get:
   *     summary: Get list of attendees for an announcement meeting (Mobile)
   *     tags: [Mobile Announcement]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: List of attendees
   */
  @Get("/:id/attendees")
  async getAttendees(
    @Param("id") id: string,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid announcement ID");
      const announcementOid = new ObjectId(id);

      const attendanceRepo = AppDataSource.getMongoRepository(Attendance);
      const [attendances, total] = await attendanceRepo.findAndCount({
        where: {
          $or: [
            { eventId: announcementOid },
            { announcementId: announcementOid }
          ]
        } as any,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      const memberIds = attendances.map(a => a.memberId);
      const memberRepo = AppDataSource.getMongoRepository(Member);
      const members = memberIds.length > 0
        ? await memberRepo.find({
          where: { _id: { $in: memberIds } } as any,
          select: ["_id", "fullName", "mobileNumber", "email", "profilePhoto", "businessName"] as any
        })
        : [];

      const memberMap = new Map<string, Member>(
        members.map(m => [m._id.toString(), m])
      );

      const result = attendances.map(att => {
        const member = memberMap.get(att.memberId.toString());
        return {
          attendanceId: att._id,
          eventId: att.eventId,
          memberId: att.memberId,
          date: att.date,
          checkInTime: att.checkInTime,
          status: att.status,
          remarks: att.remarks,
          createdAt: att.createdAt,
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

      return pagination(total, result, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
