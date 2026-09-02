import { Response, NextFunction } from "express";
import { AppDataSource } from "../data-source";
import { Franchise } from "../entity/Franchise";
import { BusinessRegion } from "../entity/BusinessRegion";
import { Member } from "../entity/Member";
import { ObjectId } from "mongodb";

export const franchiseFilter = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userRoleCode = req.user?.role?.code?.toUpperCase() || "";
    const userRoleName = req.user?.role?.name?.toUpperCase() || "";
    const isFranchiseRole = userRoleCode.includes("FRANCHISE") || userRoleName.includes("FRANCHISE");

    const userIdStr = req.user?.userId || req.user?.id || req.user?._id;
    const userIdObj = userIdStr && ObjectId.isValid(userIdStr) ? new ObjectId(userIdStr) : null;

    const franchiseRepo = AppDataSource.getMongoRepository(Franchise);

    // Find franchise linked to this user's ID or memberId
    let franchise: Franchise | null = null;

    if (userIdObj) {
      franchise = await franchiseRepo.findOne({
        where: {
          $or: [
            { userId: { $in: [userIdObj] } },
            { userId: { $in: [userIdStr] } }
          ],
          isDeleted: false
        } as any
      });
    }

    if (!franchise && req.user?.memberId && ObjectId.isValid(req.user.memberId)) {
      const memberIdObj = new ObjectId(req.user.memberId);
      franchise = await franchiseRepo.findOne({
        where: {
          $or: [
            { userId: { $in: [memberIdObj] } },
            { userId: { $in: [req.user.memberId] } }
          ],
          isDeleted: false
        } as any
      });
    }

    if (franchise && franchise.businessRegionId) {
      const businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
      const region = await businessRegionRepo.findOne({
        where: {
          $or: [
            { _id: new ObjectId(franchise.businessRegionId) },
            { "areas._id": new ObjectId(franchise.businessRegionId) }
          ],
          isDeleted: false
        } as any
      });

      const areaIds: ObjectId[] = [];

      if (region) {
        if (region._id) areaIds.push(region._id);
        if (region.areas && Array.isArray(region.areas)) {
          region.areas.forEach((area: any) => {
            if (area._id) areaIds.push(new ObjectId(area._id));
          });
        }
      } else {
        areaIds.push(new ObjectId(franchise.businessRegionId));
      }

      req.isFranchise = true;
      req.franchise = franchise;
      req.franchiseAreaIds = areaIds;

      // Optimization: Do NOT eagerly load all member IDs into memory on every request.
      // Instead, provide a lazy, request-scoped memoized getter for endpoints that specifically need IDs.
      let cachedMemberIds: ObjectId[] | null = null;
      req.getFranchiseMemberIds = async (): Promise<ObjectId[]> => {
        if (cachedMemberIds !== null) return cachedMemberIds;
        if (areaIds.length === 0) {
          cachedMemberIds = [];
          return cachedMemberIds;
        }
        const memberRepo = AppDataSource.getMongoRepository(Member);
        const members = await memberRepo.find({
          where: {
            businessRegion: { $in: areaIds },
            isDeleted: false
          } as any,
          select: ["_id"]
        });
        cachedMemberIds = members.map(m => m._id);
        return cachedMemberIds;
      };

      req.franchiseMemberIds = [];
    } else if (isFranchiseRole) {
      req.isFranchise = true;
      req.franchise = null;
      req.franchiseAreaIds = [];
      req.franchiseMemberIds = [];
      req.getFranchiseMemberIds = async () => [];
    } else {
      req.isFranchise = false;
      req.franchise = null;
      req.franchiseAreaIds = [];
      req.franchiseMemberIds = [];
      req.getFranchiseMemberIds = async () => [];
    }

    next();
  } catch (error) {
    next(error);
  }
};
