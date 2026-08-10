import {
  JsonController,
  Get,
  Put,
  Patch,
  Param,
  QueryParam,
  Body,
  Res,
  Req,
  UseBefore,
  HttpCode
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { OneToOne } from "../../entity/OneToOne";
import { ThankYouSlip } from "../../entity/ThankYouSlip";
import { Referral } from "../../entity/Referral";
import { Member } from "../../entity/Member";
import { AdminUser } from "../../entity/AdminUser";
import { ObjectId } from "mongodb";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { franchiseFilter } from "../../middlewares/FranchiseFilterMiddleware";
import { SlipService } from "../../services/slip.service";
import { UpdateSlipStatusDto } from "../../dto/mobile/Slip.dto";
import { StatusCodes } from "http-status-codes";

@JsonController("/contributions")
@UseBefore(AuthMiddleware, franchiseFilter, canAccess("contributions", "view"))
export class AdminContributionController {
  private slipService = new SlipService();
  private oneToOneRepo = AppDataSource.getMongoRepository(OneToOne);
  private tySlipRepo = AppDataSource.getMongoRepository(ThankYouSlip);
  private referralRepo = AppDataSource.getMongoRepository(Referral);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private adminUserRepo = AppDataSource.getMongoRepository(AdminUser);

  /**
   * @swagger
   * /api/admin/contributions:
   *   get:
   *     summary: Get contributions directory (Admin)
   *     tags: [Admin Contribution]
   */
  @Get("/")
  async getContributions(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("type") type: string,
    @QueryParam("roleId") roleId: string,
    @QueryParam("status") status: string,
    @QueryParam("startDate") startDate: string,
    @QueryParam("endDate") endDate: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      // Handle franchise filtering
      let franchiseMemberIds: ObjectId[] = [];
      if (req.isFranchise) {
        const fMemberWhere: any = { isDeleted: false };
        if (req.franchiseAreaIds && req.franchiseAreaIds.length > 0) {
          fMemberWhere.businessRegion = { $in: req.franchiseAreaIds };
        } else {
          fMemberWhere.businessRegion = new ObjectId();
        }
        const fMembers = await this.memberRepo.find({
          where: fMemberWhere
        });
        franchiseMemberIds = fMembers.map(m => m._id);

        if (franchiseMemberIds.length === 0) {
          return pagination(0, [], limit, page, res);
        }
      }

      let memberIds: ObjectId[] = [];
      let hasSearchOrRole = req.isFranchise;
      if (req.isFranchise) {
        memberIds = franchiseMemberIds;
      }

      // Handle role filtering
      let hasRoleFilter = false;
      let roleMemberIds: ObjectId[] = [];
      if (roleId && ObjectId.isValid(roleId)) {
        hasRoleFilter = true;
        const adminUsers = await this.adminUserRepo.find({
          where: { roleId: new ObjectId(roleId), isDeleted: false }
        });
        const adminUserIds = adminUsers.map(u => u.id);
        const members = await this.memberRepo.find({
          where: { createdBy: { $in: adminUserIds }, isDeleted: false } as any
        });
        roleMemberIds = members.map(m => m._id);
      }

      if (search) {
        hasSearchOrRole = true;
        const matchingMembers = await this.memberRepo.find({
          where: {
            fullName: { $regex: search, $options: "i" }
          }
        });
        const searchMemberIds = matchingMembers.map(m => m._id);

        if (req.isFranchise) {
          const fSet = new Set(franchiseMemberIds.map(id => id.toString()));
          memberIds = searchMemberIds.filter(id => fSet.has(id.toString()));
        } else {
          memberIds = searchMemberIds;
        }

        if (hasRoleFilter) {
          const roleSet = new Set(roleMemberIds.map(id => id.toString()));
          memberIds = memberIds.filter(id => roleSet.has(id.toString()));
        }
      } else {
        if (hasRoleFilter) {
          hasSearchOrRole = true;
          if (req.isFranchise) {
            const fSet = new Set(franchiseMemberIds.map(id => id.toString()));
            memberIds = roleMemberIds.filter(id => fSet.has(id.toString()));
          } else {
            memberIds = roleMemberIds;
          }
        }
      }

      // Date filtering
      const dateQuery: any = {};
      if (startDate || endDate) {
        dateQuery.createdAt = {};
        if (startDate) {
          dateQuery.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          dateQuery.createdAt.$lte = end;
        }
      }

      // Query builders / filters
      let oneToOneQuery: any = { ...dateQuery };
      let tySlipQuery: any = { ...dateQuery };
      let referralQuery: any = { ...dateQuery };

      if (hasSearchOrRole) {
        oneToOneQuery.$or = [
          { senderId: { $in: memberIds } },
          { receiverId: { $in: memberIds } }
        ];
        tySlipQuery.$or = [
          { senderId: { $in: memberIds } },
          { receiverId: { $in: memberIds } }
        ];
        referralQuery.$or = [
          { senderId: { $in: memberIds } },
          { receiverId: { $in: memberIds } }
        ];
        if (search) {
          referralQuery.$or.push({ referralName: { $regex: search, $options: "i" } });
        }
      }

      let includeOneToOne = !type || type === "all" || type === "one_to_one";
      let includeThankYouSlip = !type || type === "all" || type === "thank_you_slip";
      let includeReferral = !type || type === "all" || type === "referral";

      if (status) {
        const statusUpper = status.toUpperCase();
        if (statusUpper === "COMPLETED") {
          referralQuery.status = statusUpper;
        } else {
          includeOneToOne = false;
          includeThankYouSlip = false;
          referralQuery.status = statusUpper;
        }
      }

      // Count operations
      let otoCount = 0;
      let tyCount = 0;
      let refCount = 0;

      if (includeOneToOne) {
        otoCount = await this.oneToOneRepo.count(oneToOneQuery);
      }
      if (includeThankYouSlip) {
        tyCount = await this.tySlipRepo.count(tySlipQuery);
      }
      if (includeReferral) {
        refCount = await this.referralRepo.count(referralQuery);
      }

      const totalCount = otoCount + tyCount + refCount;
      const takeCount = (page + 1) * limit;

      let oneToOnes: any[] = [];
      let thankYouSlips: any[] = [];
      let referrals: any[] = [];

      if (includeOneToOne) {
        oneToOnes = await this.oneToOneRepo.find({
          where: oneToOneQuery,
          order: { createdAt: "DESC" },
          take: takeCount
        });
      }
      if (includeThankYouSlip) {
        thankYouSlips = await this.tySlipRepo.find({
          where: tySlipQuery,
          order: { createdAt: "DESC" },
          take: takeCount
        });
      }
      if (includeReferral) {
        referrals = await this.referralRepo.find({
          where: referralQuery,
          order: { createdAt: "DESC" },
          take: takeCount
        });
      }

      // Merge into unified list
      const merged: any[] = [
        ...oneToOnes.map(item => ({
          id: item._id.toString(),
          type: "one_to_one",
          senderId: item.senderId,
          receiverId: item.receiverId,
          description: "One to One Completed",
          date: item.createdAt,
          status: "completed",
          original: item
        })),
        ...thankYouSlips.map(item => ({
          id: item._id.toString(),
          type: "thank_you_slip",
          senderId: item.senderId,
          receiverId: item.receiverId,
          description: `Business of ₹${item.amount?.toLocaleString() || 0} done`,
          amount: item.amount,
          businessDetails: item.businessDetails,
          date: item.createdAt,
          status: "completed",
          original: item
        })),
        ...referrals.map(item => ({
          id: item._id.toString(),
          type: "referral",
          senderId: item.senderId,
          receiverId: item.receiverId,
          description: `Referral for ${item.referralName}`,
          referralDetails: {
            referralName: item.referralName,
            referralMobile: item.referralMobile,
            referralEmail: item.referralEmail,
            location: item.location,
            comments: item.comments
          },
          date: item.createdAt,
          status: item.status?.toLowerCase() || "pending",
          original: item
        }))
      ];

      // Sort DESC by date
      merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Paginate
      const skip = page * limit;
      const pagedData = merged.slice(skip, skip + limit);

      // Populate member profiles
      const memberIdsToFetch = new Set<string>();
      pagedData.forEach(item => {
        if (item.senderId) memberIdsToFetch.add(item.senderId.toString());
        if (item.receiverId) memberIdsToFetch.add(item.receiverId.toString());
      });

      const memberMap = new Map<string, any>();
      if (memberIdsToFetch.size > 0) {
        const objectIds = Array.from(memberIdsToFetch).map(id => new ObjectId(id));
        const members = await this.memberRepo.find({
          where: { _id: { $in: objectIds } } as any
        });
        members.forEach(m => {
          memberMap.set(m._id.toString(), {
            _id: m._id,
            fullName: m.fullName,
            profilePhoto: m.profilePhoto,
            businessName: m.businessName
          });
        });
      }

      const finalData = pagedData.map(item => ({
        id: item.id,
        type: item.type,
        sender: item.senderId ? memberMap.get(item.senderId.toString()) || null : null,
        receiver: item.receiverId ? memberMap.get(item.receiverId.toString()) || null : null,
        description: item.description,
        amount: item.amount,
        businessDetails: item.businessDetails,
        referralDetails: item.referralDetails,
        date: item.date,
        status: item.status
      }));

      return pagination(totalCount, finalData, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/contributions/{id}:
   *   get:
   *     summary: Get a single contribution detail (Admin)
   *     tags: [Admin Contribution]
   */
  @Get("/:id")
  async getContributionDetail(
    @Req() req: any,
    @Param("id") id: string,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid ID" });
      }

      const objId = new ObjectId(id);
      let contribution: any = null;
      let type: string = "";

      // 1. Try ThankYouSlip
      const tySlip = await this.tySlipRepo.findOneBy({ _id: objId });
      if (tySlip) {
        contribution = tySlip;
        type = "thank_you_slip";
      } else {
        // 2. Try Referral
        const referral = await this.referralRepo.findOneBy({ _id: objId });
        if (referral) {
          contribution = referral;
          type = "referral";
        } else {
          // 3. Try OneToOne
          const oto = await this.oneToOneRepo.findOneBy({ _id: objId });
          if (oto) {
            contribution = oto;
            type = "one_to_one";
          }
        }
      }

      if (!contribution) {
        return res.status(404).json({ success: false, message: "Contribution not found" });
      }

      // Check franchise access control
      if (req.isFranchise) {
        const franchiseMemberIdStrings = new Set((req.franchiseMemberIds || []).map((mid: any) => mid.toString()));
        const isSenderFranchiseMember = contribution.senderId && franchiseMemberIdStrings.has(contribution.senderId.toString());
        const isReceiverFranchiseMember = contribution.receiverId && franchiseMemberIdStrings.has(contribution.receiverId.toString());

        if (!isSenderFranchiseMember && !isReceiverFranchiseMember) {
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }

      // Populate member profiles
      const memberMap = new Map<string, any>();
      const senderId = contribution.senderId;
      const receiverId = contribution.receiverId;
      if (senderId || receiverId) {
        const objectIds = [senderId, receiverId].filter(id => id && ObjectId.isValid(id)).map(id => new ObjectId(id));
        const members = await this.memberRepo.find({
          where: { _id: { $in: objectIds } } as any
        });
        members.forEach(m => {
          memberMap.set(m._id.toString(), {
            _id: m._id,
            fullName: m.fullName,
            profilePhoto: m.profilePhoto,
            businessName: m.businessName,
            email: m.email,
            mobileNumber: m.mobileNumber
          });
        });
      }

      const populated = {
        id: contribution._id.toString(),
        type,
        sender: senderId ? memberMap.get(senderId.toString()) || null : null,
        receiver: receiverId ? memberMap.get(receiverId.toString()) || null : null,
        description: type === "one_to_one"
          ? "One to One Completed"
          : type === "thank_you_slip"
            ? `Business of ₹${contribution.amount?.toLocaleString() || 0} done`
            : `Referral for ${contribution.referralName}`,
        amount: contribution.amount,
        businessDetails: contribution.businessDetails,
        referralDetails: type === "referral" ? {
          referralName: contribution.referralName,
          referralMobile: contribution.referralMobile,
          referralEmail: contribution.referralEmail,
          location: contribution.location,
          comments: contribution.comments
        } : undefined,
        media: contribution.media,
        date: contribution.createdAt,
        status: type === "referral" ? (contribution.status?.toLowerCase() || "pending") : "completed"
      };

      return res.status(200).json({
        success: true,
        data: populated
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/contributions/status:
   *   put:
   *     summary: Update status of a contribution slip (Admin)
   *     tags: [Admin Contribution]
   */
  @Put("/status")
  @HttpCode(StatusCodes.OK)
  async updateStatus(
    @Body() body: UpdateSlipStatusDto,
    @Res() res: any
  ) {
    try {
      const result = await this.slipService.updateStatus({
        id: body.id,
        status: body.status,
        reason: body.reason,
        type: body.type
      });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `${result.type} status updated successfully`,
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
