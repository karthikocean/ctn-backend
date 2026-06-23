import { Response, NextFunction } from "express";
import { AppDataSource } from "../data-source";
import { Franchise } from "../entity/Franchise";
import { BusinessRegion } from "../entity/BusinessRegion";
import { ObjectId } from "mongodb";

export const franchiseFilter = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role?.code?.toUpperCase() === "FRANCHIES") {
      const franchiseRepo = AppDataSource.getMongoRepository(Franchise);
      const franchise = await franchiseRepo.findOne({
        where: {
          userId: { $in: [new ObjectId(req.user.userId)] },
          isDeleted: false
        }
      });

      if (franchise && franchise.businessRegionId) {
        const businessRegionRepo = AppDataSource.getMongoRepository(BusinessRegion);
        const region = await businessRegionRepo.findOne({
          where: {
            $or: [
              { _id: franchise.businessRegionId },
              { "areas._id": franchise.businessRegionId }
            ],
            isDeleted: false
          } as any
        });

        req.isFranchise = true;
        req.franchise = franchise;
        req.franchiseAreaIds = region ? [new ObjectId(franchise.businessRegionId)] : [];
      } else {
        req.isFranchise = true;
        req.franchise = null;
        req.franchiseAreaIds = [];
      }
    } else {
      req.isFranchise = false;
      req.franchise = null;
      req.franchiseAreaIds = [];
    }
    next();
  } catch (error) {
    next(error);
  }
};
