import { JsonController, Get, Res, UseBefore } from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Spotlight, SpotlightStatus } from "../../entity/Spotlight";
import { Member } from "../../entity/Member";
import { Category } from "../../entity/Category";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/spotlights")
@UseBefore(MobileAuthMiddleware)
export class MobileSpotlightController {
  private spotlightRepo = AppDataSource.getMongoRepository(Spotlight);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /mobile-api/spotlights/active:
   *   get:
   *     summary: Get the currently active spotlight
   *     tags: [Mobile Spotlight]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Active spotlight data
   */
  @Get("/active")
  async getActive(@Res() res: any) {
    try {
      const spotlight = await this.spotlightRepo.findOne({
        where: {
          status: SpotlightStatus.ACTIVE,
          isDeleted: false
        },
        order: { scheduleDate: "DESC" }
      });

      if (!spotlight) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: null
        });
      }

      // Fetch member details
      const members = await this.memberRepo.find({
        where: { 
            _id: { $in: spotlight.members },
            isDeleted: false
        }
      });

      // Fetch categories for members
      const categoryIds = members
        .map(m => m.businessCategory)
        .filter(id => id) as ObjectId[];
      
      let categoryMap = new Map();
      if (categoryIds.length > 0) {
        const categories = await this.categoryRepo.find({
            where: { _id: { $in: categoryIds } }
        });
        categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));
      }

      const membersWithDetails = members.map(m => ({
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          ...spotlight,
          members: membersWithDetails
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
