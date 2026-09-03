import {
  JsonController,
  Get,
  QueryParam,
  Res,
  UseBefore,
  Req,
  BadRequestError,
  NotFoundError
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { Member } from "../../entity/Member";
import { OneToOne } from "../../entity/OneToOne";
import { Referral } from "../../entity/Referral";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { ReportedHistory } from "../../entity/ReportedHistory";
import { Category } from "../../entity/Category";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { ObjectId } from "mongodb";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";

@JsonController("/connections")
@UseBefore(AuthMiddleware, franchiseFilter)
export class ConnectionController {
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private thankYouSlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /api/admin/connections:
   *   get:
   *     summary: Get Member Connection & Engagement Summary (Default) or History (view=history) (Admin)
   *     tags: [Admin Connection]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: view
   *         schema: { type: string, enum: [summary, history] }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [PENDING, ACCEPTED, REJECTED, BLOCKED, CANCELLED] }
   */
  @Get("/")
  @UseBefore(canAccess("connections", "view"))
  async getConnectionsList(
    @Req() req: any,
    @QueryParam("view") view: string,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: ConnectionStatus,
    @QueryParam("regionId") regionId: string,
    @Res() res: any
  ) {
    if (view === "history" || (status && !view)) {
      return this.getConnectionsHistory(req, page, limit, search, status, res);
    }
    return this.getEngagementSummary(req, page, limit, search, regionId, res);
  }

  /**
   * Legacy raw connection request pair history
   */
  @Get("/history")
  @UseBefore(canAccess("connections", "view"))
  async getConnectionsHistory(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("status") status: ConnectionStatus,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };

      if (status) {
        where.status = status;
      }

      // Handle search filter
      if (search) {
        const matchedMembers = await this.memberRepo.find({
          where: {
            isDeleted: false,
            $or: [
              { fullName: { $regex: search, $options: "i" } },
              { businessName: { $regex: search, $options: "i" } }
            ]
          } as any,
          select: ["_id"]
        });

        const matchedMemberIds = matchedMembers.map(m => m._id);

        if (matchedMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }

        where.$or = [
          { senderId: { $in: matchedMemberIds } },
          { receiverId: { $in: matchedMemberIds } }
        ];
      }

      // Handle franchise admin area filtering
      if (req.isFranchise) {
        const franchiseMembers = await this.memberRepo.find({
          where: {
            businessRegion: { $in: req.franchiseAreaIds },
            isDeleted: false
          },
          select: ["_id"]
        });
        const franchiseMemberIds = franchiseMembers.map(m => m._id);

        if (franchiseMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }

        if (where.$or) {
          const searchOr = where.$or;
          delete where.$or;
          where.$and = [
            { $or: searchOr },
            {
              $or: [
                { senderId: { $in: franchiseMemberIds } },
                { receiverId: { $in: franchiseMemberIds } }
              ]
            }
          ];
        } else {
          where.$or = [
            { senderId: { $in: franchiseMemberIds } },
            { receiverId: { $in: franchiseMemberIds } }
          ];
        }
      }

      const [connections, total] = await this.connectionRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { updatedAt: "DESC" }
      });

      // Populate Member Info for sender and receiver
      const senderIds = connections.map(c => c.senderId);
      const receiverIds = connections.map(c => c.receiverId);
      const allMemberIds = Array.from(
        new Set([...senderIds, ...receiverIds].map(id => id.toString()))
      ).map(id => new ObjectId(id));

      const members = allMemberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: allMemberIds } } as any })
        : [];

      const memberMap = new Map(
        members.map(m => [
          m._id.toString(),
          {
            _id: m._id,
            fullName: m.fullName,
            profilePhoto: m.profilePhoto,
            businessName: m.businessName,
            city: m.city
          }
        ])
      );

      const data = connections.map(c => {
        const sender = memberMap.get(c.senderId.toString()) || null;
        const receiver = memberMap.get(c.receiverId.toString()) || null;

        return {
          ...c,
          sender,
          receiver
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/connections/summary:
   *   get:
   *     summary: Get Member Connection and Engagement Activity Summary (Admin)
   *     tags: [Admin Connection]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: regionId
   *         schema: { type: string }
   */
  @Get("/summary")
  @UseBefore(canAccess("connections", "view"))
  async getEngagementSummary(
    @Req() req: any,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("search") search: string,
    @QueryParam("regionId") regionId: string,
    @Res() res: any
  ) {
    try {
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(500, Number(limitParam) || 10);

      const where: any = { isDeleted: false };

      if (search && search.trim()) {
        const term = search.trim();
        where.$or = [
          { fullName: { $regex: term, $options: "i" } },
          { businessName: { $regex: term, $options: "i" } },
          { mobileNumber: { $regex: term, $options: "i" } }
        ];
      }

      if (regionId && ObjectId.isValid(regionId)) {
        where.businessRegion = new ObjectId(regionId);
      }

      // Franchise area filtering
      if (req.isFranchise && req.franchiseAreaIds && req.franchiseAreaIds.length > 0) {
        if (where.businessRegion) {
          const hasAccess = req.franchiseAreaIds.some(
            (id: any) => id.toString() === where.businessRegion.toString()
          );
          if (!hasAccess) {
            return pagination(0, [], limit, page, res);
          }
        } else {
          where.businessRegion = { $in: req.franchiseAreaIds };
        }
      }

      const [members, total] = await this.memberRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      if (members.length === 0) {
        return pagination(total, [], limit, page, res);
      }

      const memberIds = members.map(m => m._id);

      // Fetch Categories
      const categoryIds = Array.from(
        new Set(
          members
            .flatMap(m => [m.businessCategory, m.subCategory])
            .filter((id): id is ObjectId => !!id)
            .map(id => id.toString())
        )
      ).map(id => new ObjectId(id));

      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];
      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      // 1. Fetch Connections for page members
      const connections = await this.connectionRepo.find({
        where: {
          isDeleted: { $ne: true },
          $or: [
            { senderId: { $in: memberIds } },
            { receiverId: { $in: memberIds } }
          ]
        } as any
      });

      // 2. Fetch Direct 1-to-1 Meetings
      const oneToOnes = await this.oneToOneRepo.find({
        where: {
          $or: [
            { senderId: { $in: memberIds } },
            { receiverId: { $in: memberIds } }
          ]
        } as any
      });

      // 3. Fetch Recommendations / Referrals (Given & Received)
      const referrals = await this.referralRepo.find({
        where: {
          $or: [
            { senderId: { $in: memberIds } },
            { receiverId: { $in: memberIds } }
          ]
        } as any
      });

      // 4. Fetch Thank You Slips (Business Done Received & Given)
      const thankYouSlips = await this.thankYouSlipRepo.find({
        where: {
          $or: [
            { receiverId: { $in: memberIds } },
            { senderId: { $in: memberIds } }
          ]
        } as any
      });

      // 5. Fetch Reports against member
      const reportedHistories = await this.reportedHistoryRepo.find({
        where: {
          targetUserId: { $in: memberIds },
          status: "REPORTED",
          isDeleted: { $ne: true }
        } as any
      });

      // Build Engagement Maps per Member
      const data = members.map(m => {
        const mIdStr = m._id.toString();

        // Connection counts
        let totalReqGivenCount = 0;
        let sentAcceptedCount = 0;
        let sentRejectedCount = 0;
        let receivedAcceptedCount = 0;
        let receivedRejectedCount = 0;

        connections.forEach(c => {
          const sId = c.senderId?.toString();
          const rId = c.receiverId?.toString();

          if (sId === mIdStr) {
            totalReqGivenCount++;
            if (c.status === ConnectionStatus.ACCEPTED) sentAcceptedCount++;
            else if (c.status === ConnectionStatus.REJECTED) sentRejectedCount++;
          }
          if (rId === mIdStr) {
            if (c.status === ConnectionStatus.ACCEPTED) receivedAcceptedCount++;
            else if (c.status === ConnectionStatus.REJECTED) receivedRejectedCount++;
          }
        });

        // Direct Meet Count (both created and participated in)
        let directMeetCount = 0;
        oneToOnes.forEach(o => {
          if (o.senderId?.toString() === mIdStr || o.receiverId?.toString() === mIdStr) {
            directMeetCount++;
          }
        });

        // Recommendations Count
        let giveRecommendationsCount = 0;
        let recommendationReceivedCount = 0;
        referrals.forEach(r => {
          if (r.senderId?.toString() === mIdStr) {
            giveRecommendationsCount++;
          }
          if (r.receiverId?.toString() === mIdStr) {
            recommendationReceivedCount++;
          }
        });

        // Received Business Done Count & Amount (he received)
        let receivedBusinessDoneCount = 0;
        let receivedBusinessDoneAmount = 0;
        thankYouSlips.forEach(t => {
          if (t.receiverId?.toString() === mIdStr) {
            receivedBusinessDoneCount++;
            receivedBusinessDoneAmount += Number(t.amount) || 0;
          }
        });

        // Reported Count (who reported him)
        let reportedCount = 0;
        reportedHistories.forEach(rh => {
          if (rh.targetUserId?.toString() === mIdStr) {
            reportedCount++;
          }
        });

        const catName = m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null;
        const subCatName = m.subCategory ? categoryMap.get(m.subCategory.toString()) : null;

        return {
          _id: m._id,
          fullName: m.fullName,
          profilePhoto: m.profilePhoto || null,
          businessName: m.businessName || "N/A",
          categoryName: catName || "N/A",
          subCategoryName: subCatName || null,
          mobileNumber: m.mobileNumber,
          city: m.city || null,
          totalReqGivenCount,
          sentAcceptedCount,
          sentRejectedCount,
          receivedAcceptedCount,
          receivedRejectedCount,
          directMeetCount,
          giveRecommendationsCount,
          recommendationReceivedCount,
          receivedBusinessDoneCount,
          receivedBusinessDoneAmount,
          businessDoneCount: receivedBusinessDoneCount,
          businessDoneAmount: receivedBusinessDoneAmount,
          reportedCount
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/connections/drilldown:
   *   get:
   *     summary: Get Drilldown Members list for Popup Modal (Admin)
   *     tags: [Admin Connection]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: memberId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: type
   *         required: true
   *         schema: { type: string, enum: [sent_accepted, sent_rejected, received_accepted, received_rejected, direct_meet, recommendation_received, business_done] }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 10 }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   */
  @Get("/drilldown")
  @Get("/details")
  @UseBefore(canAccess("connections", "view"))
  async getDrilldownList(
    @QueryParam("memberId") memberId: string,
    @QueryParam("type") type: string,
    @QueryParam("page") pageParam: number,
    @QueryParam("limit") limitParam: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    try {
      if (!memberId || !ObjectId.isValid(memberId)) {
        throw new BadRequestError("Valid memberId is required");
      }
      if (!type) {
        throw new BadRequestError("Drilldown type is required");
      }

      const targetId = new ObjectId(memberId);
      const page = Math.max(0, Number(pageParam) || 0);
      const limit = Math.min(500, Number(limitParam) || 10);

      let targetMemberIds: { otherMemberId: ObjectId; date: Date; status: string; recordId: ObjectId; meta?: any }[] = [];

      switch (type) {
        case "total_req_given": {
          const conns = await this.connectionRepo.find({
            where: {
              senderId: targetId,
              isDeleted: false
            },
            order: { createdAt: "DESC" }
          });
          targetMemberIds = conns.map(c => ({
            otherMemberId: c.receiverId,
            date: c.createdAt,
            status: c.status ? (c.status.charAt(0).toUpperCase() + c.status.slice(1).toLowerCase()) : "Pending",
            recordId: c._id
          }));
          break;
        }

        case "sent_accepted": {
          const conns = await this.connectionRepo.find({
            where: {
              senderId: targetId,
              status: ConnectionStatus.ACCEPTED,
              isDeleted: false
            },
            order: { updatedAt: "DESC" }
          });
          targetMemberIds = conns.map(c => ({
            otherMemberId: c.receiverId,
            date: c.updatedAt || c.createdAt,
            status: "Accepted",
            recordId: c._id
          }));
          break;
        }

        case "sent_rejected": {
          const conns = await this.connectionRepo.find({
            where: {
              senderId: targetId,
              status: ConnectionStatus.REJECTED,
              isDeleted: false
            },
            order: { updatedAt: "DESC" }
          });
          targetMemberIds = conns.map(c => ({
            otherMemberId: c.receiverId,
            date: c.updatedAt || c.createdAt,
            status: "Rejected",
            recordId: c._id
          }));
          break;
        }

        case "direct_meet": {
          const meets = await this.oneToOneRepo.find({
            where: {
              $or: [{ senderId: targetId }, { receiverId: targetId }]
            } as any,
            order: { createdAt: "DESC" }
          });
          targetMemberIds = meets.map(m => {
            const isSender = m.senderId.toString() === targetId.toString();
            return {
              otherMemberId: isSender ? m.receiverId : m.senderId,
              date: m.createdAt,
              status: m.status || "Completed",
              recordId: m._id,
              meta: { media: m.media, reason: m.reason, role: isSender ? "Creator" : "Participant" }
            };
          });
          break;
        }

        case "give_recommendations":
        case "recommendation_given": {
          const refs = await this.referralRepo.find({
            where: { senderId: targetId },
            order: { createdAt: "DESC" }
          });
          targetMemberIds = refs.map(r => ({
            otherMemberId: r.receiverId,
            date: r.createdAt,
            status: r.status || "Given",
            recordId: r._id,
            meta: {
              referralName: r.referralName,
              referralMobile: r.referralMobile,
              comments: r.comments
            }
          }));
          break;
        }

        case "received_business_done":
        case "business_done": {
          const slips = await this.thankYouSlipRepo.find({
            where: {
              receiverId: targetId
            } as any,
            order: { createdAt: "DESC" }
          });
          targetMemberIds = slips.map(s => ({
            otherMemberId: s.senderId,
            date: s.createdAt,
            status: s.status || "Received",
            recordId: s._id,
            meta: {
              amount: s.amount,
              businessDetails: s.businessDetails,
              type: "Received"
            }
          }));
          break;
        }

        case "reported": {
          const reports = await this.reportedHistoryRepo.find({
            where: {
              targetUserId: targetId,
              status: "REPORTED",
              isDeleted: { $ne: true }
            } as any,
            order: { createdAt: "DESC" }
          });
          targetMemberIds = reports.map(r => ({
            otherMemberId: r.reporterUserId,
            date: r.createdAt,
            status: "Reported",
            recordId: r._id,
            meta: {
              reason: r.reason || "Reported Member",
              moduleName: r.moduleName || "General"
            }
          }));
          break;
        }

        case "received_accepted": {
          const conns = await this.connectionRepo.find({
            where: {
              receiverId: targetId,
              status: ConnectionStatus.ACCEPTED,
              isDeleted: false
            },
            order: { updatedAt: "DESC" }
          });
          targetMemberIds = conns.map(c => ({
            otherMemberId: c.senderId,
            date: c.updatedAt || c.createdAt,
            status: "Accepted",
            recordId: c._id
          }));
          break;
        }

        case "received_rejected": {
          const conns = await this.connectionRepo.find({
            where: {
              receiverId: targetId,
              status: ConnectionStatus.REJECTED,
              isDeleted: false
            },
            order: { updatedAt: "DESC" }
          });
          targetMemberIds = conns.map(c => ({
            otherMemberId: c.senderId,
            date: c.updatedAt || c.createdAt,
            status: "Rejected",
            recordId: c._id
          }));
          break;
        }

        case "recommendation_received": {
          const refs = await this.referralRepo.find({
            where: { receiverId: targetId },
            order: { createdAt: "DESC" }
          });
          targetMemberIds = refs.map(r => ({
            otherMemberId: r.senderId,
            date: r.createdAt,
            status: r.status || "Received",
            recordId: r._id,
            meta: {
              referralName: r.referralName,
              referralMobile: r.referralMobile,
              comments: r.comments
            }
          }));
          break;
        }

        default:
          throw new BadRequestError(`Unsupported drilldown type: ${type}`);
      }

      if (targetMemberIds.length === 0) {
        return pagination(0, [], limit, page, res);
      }

      // Fetch member profiles
      const uniqueOtherIds = Array.from(
        new Set(targetMemberIds.map(t => t.otherMemberId.toString()))
      ).map(id => new ObjectId(id));

      const memberQuery: any = {
        _id: { $in: uniqueOtherIds },
        isDeleted: false
      };

      if (search && search.trim()) {
        const term = search.trim();
        memberQuery.$or = [
          { fullName: { $regex: term, $options: "i" } },
          { businessName: { $regex: term, $options: "i" } },
          { mobileNumber: { $regex: term, $options: "i" } }
        ];
      }

      const members = await this.memberRepo.find({ where: memberQuery });
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      // Fetch Categories for populated members
      const catIds = Array.from(
        new Set(
          members
            .flatMap(m => [m.businessCategory, m.subCategory])
            .filter((id): id is ObjectId => !!id)
            .map(id => id.toString())
        )
      ).map(id => new ObjectId(id));

      const categories = catIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: catIds } } as any })
        : [];
      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      // Assemble list matching search filter
      const filteredList: any[] = [];
      targetMemberIds.forEach(t => {
        const m = memberMap.get(t.otherMemberId.toString());
        if (m) {
          const catName = m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null;
          const subCatName = m.subCategory ? categoryMap.get(m.subCategory.toString()) : null;

          filteredList.push({
            _id: t.recordId,
            memberId: m._id,
            name: m.fullName,
            companyName: m.businessName || "N/A",
            category: catName || "N/A",
            subCategory: subCatName || null,
            profile: m.profilePhoto || null,
            mobileNumber: m.mobileNumber || null,
            city: m.city || null,
            date: t.date,
            status: t.status,
            details: t.meta || {}
          });
        }
      });

      const total = filteredList.length;
      const paginatedData = filteredList.slice(page * limit, (page + 1) * limit);

      return pagination(total, paginatedData, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
