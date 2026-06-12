import {
  JsonController,
  Get,
  QueryParam,
  Res,
  UseBefore,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { Member } from "../../entity/Member";
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

  /**
   * @swagger
   * /api/admin/connections:
   *   get:
   *     summary: Get connections history with search, status filter, and pagination (Admin)
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
   *         name: status
   *         schema: { type: string, enum: [PENDING, ACCEPTED, REJECTED, BLOCKED, CANCELLED] }
   */
  @Get("/")
  @UseBefore(canAccess("connections", "view"))
  async getConnectionsList(
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
      const where: any = {};

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
}
