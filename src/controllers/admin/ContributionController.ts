import {
  JsonController,
  Get,
  QueryParam,
  Res,
  Req,
  UseBefore
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

@JsonController("/contributions")
@UseBefore(AuthMiddleware, canAccess("contributions", "view"))
export class AdminContributionController {
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
      let memberIds: ObjectId[] = [];
      let hasSearchOrRole = false;

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
        memberIds = matchingMembers.map(m => m._id);

        if (hasRoleFilter) {
          const roleSet = new Set(roleMemberIds.map(id => id.toString()));
          memberIds = memberIds.filter(id => roleSet.has(id.toString()));
        }
      } else if (hasRoleFilter) {
        hasSearchOrRole = true;
        memberIds = roleMemberIds;
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
}
