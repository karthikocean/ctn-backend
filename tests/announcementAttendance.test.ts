jest.mock("../src/config/appRedis", () => ({
  appRedis: {
    status: "end",
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn()
  },
  redisConnection: {
    status: "end",
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn()
  }
}));

import { ObjectId } from "mongodb";
import { AppDataSource } from "../src/data-source";
import { MobileAnnouncementController } from "../src/controllers/mobile/AnnouncementController";
import { Announcement, AnnouncementType } from "../src/entity/Announcement";
import { Member, MemberStatus } from "../src/entity/Member";
import { AnnouncementBooking } from "../src/entity/AnnouncementBooking";
import { StallBooking } from "../src/entity/StallBooking";
import { Attendance, AttendanceStatus } from "../src/entity/Attendance";

describe("Announcement Meeting Attendance API", () => {
  let controller: MobileAnnouncementController;
  let mockRes: any;
  let mockReq: any;

  let mockAnnouncementRepo: any;
  let mockMemberRepo: any;
  let mockEventBookingRepo: any;
  let mockStallBookingRepo: any;
  let mockAttendanceRepo: any;

  const testMemberId = new ObjectId();
  const testAnnouncementId = new ObjectId();
  const testBookingId = new ObjectId();

  beforeEach(() => {
    controller = new MobileAnnouncementController();

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockReq = {
      user: { userId: testMemberId.toString() }
    };

    mockAnnouncementRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn()
    };

    mockMemberRepo = {
      findOne: jest.fn(),
      find: jest.fn()
    };

    mockEventBookingRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn()
    };

    mockStallBookingRepo = {
      findOne: jest.fn(),
      find: jest.fn()
    };

    mockAttendanceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: any) => ({ _id: new ObjectId(), ...data })),
      save: jest.fn((data: any) => Promise.resolve({ _id: data._id || new ObjectId(), ...data }))
    };

    jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
      if (entity === Announcement) return mockAnnouncementRepo;
      if (entity === Member) return mockMemberRepo;
      if (entity === AnnouncementBooking) return mockEventBookingRepo;
      if (entity === StallBooking) return mockStallBookingRepo;
      if (entity === Attendance) return mockAttendanceRepo;
      return {} as any;
    });

    (controller as any).announcementRepo = mockAnnouncementRepo;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Attendance Entity Model", () => {
    it("should instantiate Attendance with required and additional fields", () => {
      const att = new Attendance();
      att.memberId = testMemberId;
      att.eventId = testAnnouncementId;
      att.announcementId = testAnnouncementId;
      att.bookingId = testBookingId;
      att.date = new Date();
      att.checkInTime = "10:30 AM";
      att.status = AttendanceStatus.PRESENT;
      att.remarks = "Checked in successfully";

      expect(att.memberId).toBe(testMemberId);
      expect(att.eventId).toBe(testAnnouncementId);
      expect(att.announcementId).toBe(testAnnouncementId);
      expect(att.bookingId).toBe(testBookingId);
      expect(att.status).toBe("present");
      expect(att.checkInTime).toBe("10:30 AM");
    });
  });

  describe("POST /attendance (Mark Attendance via body)", () => {
    it("should reject attendance if eventId is missing", async () => {
      await controller.markAttendance(mockReq, {} as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          message: expect.stringContaining("eventId is required")
        })
      );
    });

    it("should reject attendance if member has NOT booked the meeting", async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        title: "CTN Annual Meeting",
        announcementType: AnnouncementType.EVENT,
        isDeleted: false
      });

      mockMemberRepo.findOne.mockResolvedValue({
        _id: testMemberId,
        fullName: "John Doe",
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      // Member did NOT book
      mockEventBookingRepo.findOne.mockResolvedValue(null);
      mockStallBookingRepo.findOne.mockResolvedValue(null);

      await controller.markAttendance(
        mockReq,
        { eventId: testAnnouncementId.toString() },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          message: expect.stringContaining("Member has not booked this announcement meeting")
        })
      );
    });

    it("should successfully mark attendance when member HAS booked the meeting", async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        title: "CTN Annual Meeting",
        announcementType: AnnouncementType.EVENT,
        isDeleted: false
      });

      mockMemberRepo.findOne.mockResolvedValue({
        _id: testMemberId,
        fullName: "John Doe",
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      // Member HAS booked
      mockEventBookingRepo.findOne.mockResolvedValue({
        _id: testBookingId,
        announcementId: testAnnouncementId,
        memberId: testMemberId,
        status: "booked"
      });

      // No previous attendance
      mockAttendanceRepo.findOne.mockResolvedValue(null);

      await controller.markAttendance(
        mockReq,
        {
          eventId: testAnnouncementId.toString(),
          remarks: "Mobile QR check-in"
        },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Attendance marked successfully",
          data: expect.objectContaining({
            memberId: testMemberId,
            eventId: testAnnouncementId,
            bookingId: testBookingId,
            status: "present"
          })
        })
      );
    });

    it("should reject duplicate attendance if member already attended", async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        title: "CTN Annual Meeting",
        announcementType: AnnouncementType.EVENT,
        isDeleted: false
      });

      mockMemberRepo.findOne.mockResolvedValue({
        _id: testMemberId,
        fullName: "John Doe",
        status: MemberStatus.ACTIVE,
        isDeleted: false
      });

      mockEventBookingRepo.findOne.mockResolvedValue({
        _id: testBookingId,
        announcementId: testAnnouncementId,
        memberId: testMemberId,
        status: "booked"
      });

      // Already marked attendance
      mockAttendanceRepo.findOne.mockResolvedValue({
        _id: new ObjectId(),
        eventId: testAnnouncementId,
        memberId: testMemberId,
        status: "present"
      });

      await controller.markAttendance(
        mockReq,
        { eventId: testAnnouncementId.toString() },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          message: "Attendance has already been marked for this meeting"
        })
      );
    });

    it("should reject attendance if member is inactive", async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue({
        _id: testAnnouncementId,
        title: "CTN Annual Meeting",
        isDeleted: false
      });

      mockMemberRepo.findOne.mockResolvedValue({
        _id: testMemberId,
        fullName: "John Doe",
        status: MemberStatus.INACTIVE,
        isDeleted: false
      });

      await controller.markAttendance(
        mockReq,
        { eventId: testAnnouncementId.toString() },
        mockRes
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          message: "Member account is inactive or blocked"
        })
      );
    });
  });

  describe("GET /:id/attendance (Get Attendance Status)", () => {
    it("should return booking and attendance status for current user", async () => {
      mockEventBookingRepo.findOne.mockResolvedValue({
        _id: testBookingId,
        status: "booked"
      });
      mockStallBookingRepo.findOne.mockResolvedValue(null);
      mockAttendanceRepo.findOne.mockResolvedValue({
        _id: new ObjectId(),
        eventId: testAnnouncementId,
        date: new Date(),
        checkInTime: "10:00 AM",
        status: "present"
      });

      await controller.getAttendanceStatus(mockReq, testAnnouncementId.toString(), mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            isBooked: true,
            isAttended: true
          })
        })
      );
    });
  });

  describe("GET /my-attendances (List Member Attendances)", () => {
    it("should return attended meetings populated with announcement details", async () => {
      const attRecord = {
        _id: new ObjectId(),
        eventId: testAnnouncementId,
        memberId: testMemberId,
        date: new Date(),
        checkInTime: "09:30 AM",
        status: "present"
      };
      mockAttendanceRepo.find.mockResolvedValue([attRecord]);

      mockAnnouncementRepo.find.mockResolvedValue([
        {
          _id: testAnnouncementId,
          title: "Weekly Chapter Meeting",
          announcementType: AnnouncementType.EVENT,
          date: new Date(),
          time: "09:30 AM",
          location: "Grand Ballroom"
        }
      ]);

      await controller.getMyAttendances(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              attendanceId: attRecord._id,
              status: "present",
              announcement: expect.objectContaining({
                title: "Weekly Chapter Meeting",
                location: "Grand Ballroom"
              })
            })
          ])
        })
      );
    });
  });
});
