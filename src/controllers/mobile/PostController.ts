import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { PostModel as PostEntity, PostType, RequirementVisibility } from "../../entity/Post";
import { Member } from "../../entity/Member";
import { State } from "../../entity/State";
import { Connection, ConnectionStatus } from "../../entity/Connection";
import { Category } from "../../entity/Category";
import { Conversation } from "../../entity/Conversation";
import { Message, MessageType } from "../../entity/Message";
import { SavedPost } from "../../entity/SavedPost";
import { PostReport } from "../../entity/PostReport";
import { ReportedHistory } from "../../entity/ReportedHistory";
import { CreatePostDto, UpdatePostDto } from "../../dto/mobile/Post.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";
import { getIO, isUserInConversation } from "../../utils/socket";
import { validateModuleUsage } from "../../services/moduleUsage.service";
import { SubscriptionService } from "../../services/subscription.service";
import { PointService } from "../../services/point.service";
import { PointConfigType } from "../../entity/PointConfig";
import { DailyScoreService } from "../../services/dailyScore.service";
import { notifyPostAudience, notifyGivePostAudience, insertPushNotification } from "../../services/pushnotification.service";
import { NotificationModule } from "../../entity/PushNotifications";

const getObjectIdStr = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (val.$oid && typeof val.$oid === "string") return val.$oid;
  if (val.toString) return val.toString();
  return null;
};

@JsonController("/posts")
@UseBefore(MobileAuthMiddleware)
export class MobilePostController {
  private postRepo = AppDataSource.getMongoRepository(PostEntity);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private connectionRepo = AppDataSource.getMongoRepository(Connection);
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private conversationRepo = AppDataSource.getMongoRepository(Conversation);
  private messageRepo = AppDataSource.getMongoRepository(Message);
  private savedPostRepo = AppDataSource.getMongoRepository(SavedPost);
  private subscriptionService = new SubscriptionService();

  private getCategoryVisibilityFilter(currentMember: Member) {
    const memberCategory = currentMember.businessCategory ? new ObjectId(currentMember.businessCategory) : null;
    const memberSubcategory = currentMember.subCategory ? new ObjectId(currentMember.subCategory) : null;

    const categoryEmpty = { $or: [{ categoryIds: { $exists: false } }, { categoryIds: null }, { categoryIds: [] }] };
    const subCategoryEmpty = { $or: [{ subCategoryIds: { $exists: false } }, { subCategoryIds: null }, { subCategoryIds: [] }] };

    const categoryNotEmpty = { categoryIds: { $exists: true, $ne: null, $not: { $size: 0 } } };
    const subCategoryNotEmpty = { subCategoryIds: { $exists: true, $ne: null, $not: { $size: 0 } } };

    const conditions: any[] = [
      { $and: [categoryEmpty, subCategoryEmpty] }
    ];

    if (memberCategory) {
      conditions.push({
        $and: [
          categoryNotEmpty,
          subCategoryEmpty,
          { categoryIds: memberCategory }
        ]
      });
    }

    if (memberSubcategory) {
      conditions.push({
        $and: [
          subCategoryNotEmpty,
          { subCategoryIds: memberSubcategory }
        ]
      });
    }

    return { $or: conditions };
  }

  private applyCategoryVisibilityFilter(where: any, currentMember: Member) {
    const visibilityFilter = this.getCategoryVisibilityFilter(currentMember);
    if (where.$or) {
      const existingOr = where.$or;
      delete where.$or;
      where.$and = [
        ...(where.$and || []),
        { $or: existingOr },
        visibilityFilter
      ];
    } else {
      if (where.$and) {
        where.$and.push(visibilityFilter);
      } else {
        where.$and = [visibilityFilter];
      }
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/daily-counts:
   *   get:
   *     summary: Get daily creation counts and plan limits for post cards (Mobile)
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Daily post card counts retrieved successfully
   */
  @Get("/daily-counts")
  async getDailyCounts(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const data = await this.subscriptionService.getCardDailyCounts(userId);
      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts:
   *   post:
   *     summary: Create a new post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreatePostDto'
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Req() req: any, @Body() data: CreatePostDto, @Res() res: any) {
    try {
      const userId = req.user.userId;
      const memberObjectId = new ObjectId(userId);
      // Map post type to module name: ASK -> Ask, GIVE -> Give, PROMOTION -> Promotion, REQUIREMENT -> Requirement
      const moduleName = data.type === PostType.PROMOTION ? "Post" : data.type.charAt(0).toUpperCase() + data.type.slice(1).toLowerCase();

      // 1. Validate module usage limit before saving the document
      await validateModuleUsage(memberObjectId, moduleName);

      // 1.5. Validate requirement visibility target if post type is REQUIREMENT or if visibility is provided
      const inputVisibility = data.requirementVisibility || (data as any).visibility;
      const inputStateIds = data.stateIds || (data as any).states;
      const inputRegionIds = data.regionIds || (data as any).regions;

      if (data.type === PostType.REQUIREMENT && !inputVisibility) {
        throw new BadRequestError("requirementVisibility is required when post type is REQUIREMENT");
      }
      if (inputVisibility) {
        const visibilityInput = inputVisibility.toUpperCase().trim().replace(/_|\s+/g, "-");
        const validValues = Object.values(RequirementVisibility);
        if (!validValues.includes(visibilityInput as RequirementVisibility)) {
          throw new BadRequestError(`Invalid requirementVisibility. Must be one of: ${validValues.join(", ")}`);
        }
        data.requirementVisibility = visibilityInput as RequirementVisibility;
      }

      const post = new PostEntity();
      Object.assign(post, data);
      post.memberId = memberObjectId;
      post.isDeleted = false;
      post.isActive = true;

      // Convert stateIds / regionIds string arrays/objects to ObjectId arrays
      if (Array.isArray(inputStateIds)) {
        post.stateIds = inputStateIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }
      if (Array.isArray(inputRegionIds)) {
        post.regionIds = inputRegionIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }

      if (Array.isArray(data.categoryIds)) {
        post.categoryIds = data.categoryIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }
      if (Array.isArray(data.subCategoryIds)) {
        post.subCategoryIds = data.subCategoryIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }

      // Remove any legacy unmapped keys so they don't persist in DB
      delete (post as any).visibility;
      delete (post as any).states;
      delete (post as any).regions;

      const savedPost = await this.postRepo.save(post);
      if (post.type !== PostType.PROMOTION) {
        const senderMember = await this.memberRepo.findOneBy({ _id: memberObjectId });
        const senderName = senderMember?.fullName ? senderMember.fullName.trim() : "Member";
        const formattedType = post.type.charAt(0).toUpperCase() + post.type.slice(1).toLowerCase();
        const subject = `${senderName} ${formattedType}`;
        const content = data.title;

        if (post.type === PostType.GIVE) {
          notifyGivePostAudience({
            post: savedPost,
            senderId: userId,
            subject,
            content
          }).catch(err => console.error("[PostController] notifyGivePostAudience error:", err));
        } else {
          // Notify relevant members about the new post (non-blocking)
          notifyPostAudience({
            post: savedPost,
            senderId: userId,
            subject,
            content
          }).catch(err => console.error("[PostController] notifyPostAudience error:", err));
        }
      }
      let pointsResult = { awarded: 0, balance: 0 };
      // 2. Award Points
      try {
        let pointModuleName = moduleName;
        if (data.type === PostType.PROMOTION) {
          pointModuleName = "Post";
        }
        const pointService = new PointService();
        pointsResult = await pointService.awardPoints({
          memberId: memberObjectId,
          moduleName: pointModuleName,
          type: PointConfigType.CREATION,
          referenceId: savedPost._id
        });
      } catch (pointError) {
        console.error("Failed to award points for post creation:", pointError);
      }

      // 2.5 Award Daily Score Checklist Points
      try {
        const dailyScoreService = new DailyScoreService();
        await dailyScoreService.awardDailyScore(
          memberObjectId,
          moduleName,
          savedPost._id
        );
      } catch (dailyScoreError) {
        console.error("Failed to award daily score for post creation:", dailyScoreError);
      }

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Post created successfully",
        data: savedPost,
        points: pointsResult
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/my-posts:
   *   get:
   *     summary: Get posts of the logged-in member
   *     tags: [Mobile Post]
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
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, REQUIREMENT, GIVE, ASK]
   */
  @Get("/my-posts")
  async getMyPosts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = req.user.userId;
      const where: any = { memberId: new ObjectId(userId), isDeleted: false, status: { $ne: "reported" } };
      if (type) where.type = type;

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, posts, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/following-posts:
   *   get:
   *     summary: Get posts from members you are following
   *     tags: [Mobile Post]
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
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, REQUIREMENT, GIVE, ASK]
   */
  @Get("/following-posts")
  async getFollowingPosts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = req.user.userId;

      // 1. Find who I am following
      const followings = await this.connectionRepo.find({
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });

      console.log(`User ${userId} is following ${followings.length} members`);

      // Ensure all IDs are fresh ObjectIds for the Mongo query
      const followingIds = followings.map(f => new ObjectId(f.receiverId));

      const { reportedPostIds } = await this.getReportedDataForUser(userId);

      // 2. Fetch posts from these members
      const where: any = {
        memberId: { $in: followingIds },
        isDeleted: false,
        status: { $ne: "reported" }
      };

      if (reportedPostIds.length > 0) {
        where._id = { $nin: reportedPostIds };
      }

      if (type) where.type = type;

      const currentMember = await this.memberRepo.findOneBy({ _id: new ObjectId(userId) });
      if (!currentMember) throw new BadRequestError("Member not found");

      this.applyCategoryVisibilityFilter(where, currentMember);

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // 3. Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // 4. Fetch Category Info for Members
      const categoryIds = [...new Set(members.map(m => m.businessCategory).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null
      }]));

      // 5. Check which posts are saved by current user
      const savedPosts = await this.savedPostRepo.find({
        where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      });
      const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: savedPostIds.has(p._id.toString())
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/region-requirements:
   *   get:
   *     summary: Get requirement posts based on member's region (city/state)
   *     tags: [Mobile Post]
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
   */
  @Get("/region-requirements")
  async getRegionRequirements(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const userId = req.user.userId;
      // 1. Get logged-in member's location
      const currentMember = await this.memberRepo.findOneBy({ _id: new ObjectId(userId) });
      if (!currentMember) {
        throw new BadRequestError("Member not found");
      }

      const memberCity = currentMember.city;
      const memberBusinessRegion = currentMember.businessRegion;

      let regionMemberIds: ObjectId[] = [];
      if (memberCity || memberBusinessRegion) {
        // 2. Find members in the same region
        const locationCondition: any = { isDeleted: false };
        if (memberCity) locationCondition.city = memberCity;
        if (memberBusinessRegion) locationCondition.businessRegion = memberBusinessRegion;

        const regionMembers = await this.memberRepo.find({ where: locationCondition });
        regionMemberIds = regionMembers
          .filter(m => m._id.toString() !== userId)
          .map(m => m._id);
      }

      let memberStateId: ObjectId | null = null;
      if (currentMember.state) {
        const stateRepo = AppDataSource.getMongoRepository(State);
        const stateDoc = await stateRepo.findOne({
          where: { name: { $regex: new RegExp(`^${currentMember.state}$`, "i") }, isDeleted: false }
        });
        if (stateDoc) {
          memberStateId = stateDoc._id;
        }
      }

      // Fetch mutual friends to evaluate MUTUAL_FRIEND requirement visibility
      const following = await this.connectionRepo.find({
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });
      const followingIds = following.map(f => f.receiverId.toString());

      const followers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });
      const followerIds = followers.map(f => f.senderId.toString());

      const mutualIds = followingIds
        .filter(id => followerIds.includes(id))
        .map(id => new ObjectId(id));

      // 3. Find REQUIREMENT posts
      const where: any = {
        type: PostType.REQUIREMENT,
        isDeleted: false,
        status: { $ne: "reported" },
        memberId: { $ne: new ObjectId(userId) },
        isActive: true
      };

      const visibilityOrArray: any[] = [
        { requirementVisibility: RequirementVisibility.OVERALL }
      ];

      if (mutualIds.length > 0) {
        visibilityOrArray.push({
          requirementVisibility: RequirementVisibility.MUTUAL_FRIEND,
          memberId: { $in: mutualIds }
        });
      }

      const regionConditions: any[] = [];
      if (memberBusinessRegion) {
        regionConditions.push({ regionIds: memberBusinessRegion });
      }
      if (memberStateId) {
        regionConditions.push({ stateIds: memberStateId });
      }
      if (regionMemberIds.length > 0) {
        regionConditions.push({ memberId: { $in: regionMemberIds } });
      }

      if (regionConditions.length > 0) {
        visibilityOrArray.push({
          requirementVisibility: RequirementVisibility.REGION,
          $or: regionConditions
        });
      }

      if (regionMemberIds.length > 0) {
        visibilityOrArray.push({
          $or: [
            { requirementVisibility: { $exists: false } },
            { requirementVisibility: null }
          ],
          memberId: { $in: regionMemberIds }
        });
      }

      if (search) {
        const searchOrArray = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } }
        ];
        where.$and = [
          { $or: visibilityOrArray },
          { $or: searchOrArray }
        ];
      } else {
        where.$or = visibilityOrArray;
      }

      this.applyCategoryVisibilityFilter(where, currentMember);

      const { reportedPostIds } = await this.getReportedDataForUser(userId);
      if (reportedPostIds.length > 0) {
        const ninPostCondition = { _id: { $nin: reportedPostIds } };
        where.$and = [...(where.$and || []), ninPostCondition];
      }

      // console.log(JSON.stringify(where), 'where')
      const allPosts = await this.postRepo.find({ where });
      const total = allPosts.length;

      // Random shuffle using Math.random() (Fisher-Yates shuffle algorithm)
      const shuffledPosts = [...allPosts];
      for (let i = shuffledPosts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledPosts[i], shuffledPosts[j]] = [shuffledPosts[j], shuffledPosts[i]];
      }

      const posts = shuffledPosts.slice(page * limit, (page + 1) * limit);

      // 4. Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // Fetch categories & subcategories bulk (including member businessCategory)
      const categoryIdsToFetch = new Set<string>();
      members.forEach(m => {
        if (m.businessCategory) {
          categoryIdsToFetch.add(m.businessCategory.toString());
        }
      });
      posts.forEach(p => {
        if (p.categoryIds) {
          p.categoryIds.forEach(id => categoryIdsToFetch.add(id.toString()));
        }
        if (p.subCategoryIds) {
          p.subCategoryIds.forEach(id => categoryIdsToFetch.add(id.toString()));
        }
      });

      const uniqueCategoryIds = Array.from(categoryIdsToFetch).map(id => new ObjectId(id));
      const categoriesList = uniqueCategoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: uniqueCategoryIds } } as any })
        : [];
      const categoriesMap = new Map(categoriesList.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        city: m.city,
        businessRegion: m.businessRegion,
        categoryName: m.businessCategory ? (categoriesMap.get(m.businessCategory.toString()) || null) : null,
        businessCategoryName: m.businessCategory ? (categoriesMap.get(m.businessCategory.toString()) || null) : null,
        businessCategory: m.businessCategory ? (categoriesMap.get(m.businessCategory.toString()) || null) : null
      }]));

      // // 5. Check which posts are saved by current user
      // const savedPosts = await this.savedPostRepo.find({
      //   where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      // });
      // const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => {
        const categories = p.categoryIds
          ? p.categoryIds.map(id => ({
            _id: id,
            name: categoriesMap.get(id.toString()) || ""
          }))
          : [];
        const subCategories = p.subCategoryIds
          ? p.subCategoryIds.map(id => ({
            _id: id,
            name: categoriesMap.get(id.toString()) || ""
          }))
          : [];

        const plainPost = { ...p };
        delete plainPost.stateIds;
        delete plainPost.regionIds;
        delete plainPost.categoryIds;
        delete plainPost.subCategoryIds;

        return {
          ...plainPost,
          member: memberMap.get(p.memberId.toString()) || null,
          categories,
          subCategories
          // isSaved: savedPostIds.has(p._id.toString())
        };
      });

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/overall:
   *   get:
   *     summary: Get overall ASK and PROMOTION posts with filters and pagination
   *     tags: [Mobile Post]
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
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, ASK]
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: stateIds
   *         schema:
   *           type: string
   *         description: Comma-separated state ObjectIds to filter posts (e.g. id1,id2)
   *       - in: query
   *         name: regionIds
   *         schema:
   *           type: string
   *         description: Comma-separated region area ObjectIds to filter posts (e.g. id1,id2)
   */
  @Get("/overall")
  async getOverallPromotions(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @QueryParam("stateIds") stateIds: string,
    @QueryParam("regionIds") regionIds: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    const userId = req.user.userId;

    try {
      const allowedTypes = [PostType.PROMOTION];
      const { reportedPostIds } = await this.getReportedDataForUser(userId);
      const where: any = {
        isDeleted: false,
        status: { $ne: "reported" },
        memberId: { $ne: new ObjectId(userId) }
      };

      if (reportedPostIds.length > 0) {
        where._id = { $nin: reportedPostIds };
      }

      if (type) {
        if (!allowedTypes.includes(type)) {
          throw new BadRequestError("Invalid type. Must be either ASK or PROMOTION.");
        }
        where.type = type;
      } else {
        where.type = { $in: allowedTypes };
      }

      // Only show posts that are not targeted to any specific region (open to overall/everyone)
      where.$or = [
        { regionIds: { $exists: false } },
        { regionIds: null },
        { regionIds: { $size: 0 } }
      ];

      // Manual override: stateIds query param filters posts whose stateIds array contains any given ID
      if (stateIds) {
        const stateIdList = stateIds.split(",").map(s => s.trim()).filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s));
        if (stateIdList.length > 0) {
          where.stateIds = { $elemMatch: { $in: stateIdList } };
        }
      }
      // Manual override: regionIds query param filters posts whose regionIds array contains any given ID
      if (regionIds) {
        const regionIdList = regionIds.split(",").map(s => s.trim()).filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s));
        if (regionIdList.length > 0) {
          // Override the auto $or with specific regionIds filter
          delete where.$or;
          where.regionIds = { $elemMatch: { $in: regionIdList } };
        }
      }

      if (search) {
        where.$and = [
          ...(where.$and || []),
          {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
              { location: { $regex: search, $options: "i" } }
            ]
          }
        ];
      }

      const currentMember = await this.memberRepo.findOneBy({ _id: new ObjectId(userId) });
      if (!currentMember) throw new BadRequestError("Member not found");

      this.applyCategoryVisibilityFilter(where, currentMember);
      // console.log("where", JSON.stringify(where));s
      const allPosts = await this.postRepo.find({ where });
      const total = allPosts.length;

      // Random shuffle using Math.random() (Fisher-Yates shuffle algorithm)
      const shuffledPosts = [...allPosts];
      for (let i = shuffledPosts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledPosts[i], shuffledPosts[j]] = [shuffledPosts[j], shuffledPosts[i]];
      }

      const posts = shuffledPosts.slice(page * limit, (page + 1) * limit);

      // Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // Fetch Category Info for Members
      const categoryIds = [...new Set(members.map(m => m.businessCategory).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null
      }]));

      // Check which posts are saved by current user
      const savedPosts = await this.savedPostRepo.find({
        where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      });
      const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: savedPostIds.has(p._id.toString())
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/region:
   *   get:
   *     summary: Get ASK and PROMOTION posts based on member's region (city/state)
   *     tags: [Mobile Post]
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
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, ASK]
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   */
  @Get("/region")
  async getRegionPromotions(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const userId = req.user.userId;

      // 1. Get logged-in member's location
      const currentMember = await this.memberRepo.findOneBy({ _id: new ObjectId(userId) });
      if (!currentMember) {
        throw new BadRequestError("Member not found");
      }

      const memberBusinessRegion = currentMember.businessRegion;

      // Fetch mutual friends to evaluate MUTUAL_FRIEND requirement visibility
      const following = await this.connectionRepo.find({
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });
      const followingIds = following.map(f => f.receiverId.toString());

      const followers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });
      const followerIds = followers.map(f => f.senderId.toString());

      const mutualIds = followingIds
        .filter(id => followerIds.includes(id))
        .map(id => new ObjectId(id));

      const visibilityOrArray: any[] = [];

      if (memberBusinessRegion) {
        const memberRegionId = new ObjectId(memberBusinessRegion);
        visibilityOrArray.push({ regionIds: { $elemMatch: { $eq: memberRegionId } } });
      }

      if (mutualIds.length > 0) {
        visibilityOrArray.push({
          requirementVisibility: RequirementVisibility.MUTUAL_FRIEND,
          memberId: { $in: mutualIds }
        });
      }

      if (visibilityOrArray.length === 0) {
        // If member has no business region and no mutual friends, return empty pagination results
        return pagination(0, [], limit, page, res);
      }

      // 2. Find ASK / PROMOTION posts targeted to region or from mutual friends
      const allowedTypes = [PostType.PROMOTION, PostType.ASK];
      const where: any = {
        isDeleted: false,
        status: { $ne: "reported" },
        memberId: { $ne: new ObjectId(userId) },
        $or: visibilityOrArray
      };

      if (type) {
        if (!allowedTypes.includes(type)) {
          throw new BadRequestError("Invalid type. Must be either ASK or PROMOTION.");
        }
        where.type = type;
      } else {
        where.type = { $in: allowedTypes };
      }

      if (search) {
        where.$and = [
          ...(where.$and || []),
          {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
              { location: { $regex: search, $options: "i" } }
            ]
          }
        ];
      }

      this.applyCategoryVisibilityFilter(where, currentMember);
      const { reportedPostIds } = await this.getReportedDataForUser(userId);
      if (reportedPostIds.length > 0) {
        const ninPostCondition = { _id: { $nin: reportedPostIds } };
        where.$and = [...(where.$and || []), ninPostCondition];
      }
      // console.log('aaaaaaaa', JSON.stringify(where))
      const allPosts = await this.postRepo.find({ where });
      const total = allPosts.length;

      // Random shuffle using Math.random() (Fisher-Yates shuffle algorithm)
      const shuffledPosts = [...allPosts];
      for (let i = shuffledPosts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledPosts[i], shuffledPosts[j]] = [shuffledPosts[j], shuffledPosts[i]];
      }

      const posts = shuffledPosts.slice(page * limit, (page + 1) * limit);

      // 4. Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // Fetch Category Info for Members
      const categoryIds = [...new Set(members.map(m => m.businessCategory).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        city: m.city,
        businessRegion: m.businessRegion,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null
      }]));

      // 5. Check which posts are saved by current user
      const savedPosts = await this.savedPostRepo.find({
        where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      });
      const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: savedPostIds.has(p._id.toString())
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts:
   *   get:
   *     summary: Get all posts with filters and pagination
   *     tags: [Mobile Post]
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
   *         name: type
   *         schema:
   *           type: string
   *           enum: [PROMOTION, REQUIREMENT, GIVE, ASK]
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: memberId
   *         schema:
   *           type: string
   */
  @Get("/")
  async getAll(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("type") type: PostType,
    @QueryParam("search") search: string,
    @QueryParam("memberId") memberId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    const userId = req.user.userId;

    try {
      const where: any = { isDeleted: false, isActive: true, status: { $ne: "reported" } };

      if (type) where.type = type;

      // 1. Find who current user follows (needed for GIVE and REQUIREMENT target filters)
      const following = await this.connectionRepo.find({
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });
      const followingIds = following.map(f => f.receiverId.toString());

      // 2. Find who follows current user
      const followers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED, isDeleted: false }
      });
      const followerIds = followers.map(f => f.senderId.toString());

      // 3. Mutual = Intersection
      const mutualIds = followingIds
        .filter(id => followerIds.includes(id))
        .map(id => new ObjectId(id));

      // 4. Find members in the same region
      const currentMember = await this.memberRepo.findOneBy({ _id: new ObjectId(userId) });
      let regionMemberIds: ObjectId[] = [];
      let memberStateId: ObjectId | null = null;
      if (currentMember) {
        const locationCondition: any = { isDeleted: false };
        if (currentMember.city) locationCondition.city = currentMember.city;
        if (currentMember.businessRegion) locationCondition.businessRegion = currentMember.businessRegion;

        const regionMembers = await this.memberRepo.find({ where: locationCondition });
        regionMemberIds = regionMembers.map(m => m._id);

        if (currentMember.state) {
          const stateRepo = AppDataSource.getMongoRepository(State);
          const stateDoc = await stateRepo.findOne({
            where: { name: { $regex: new RegExp(`^${currentMember.state}$`, "i") }, isDeleted: false }
          });
          if (stateDoc) {
            memberStateId = stateDoc._id;
          }
        }
      }

      const regionConditions: any[] = [];
      if (currentMember?.businessRegion) {
        regionConditions.push({ regionIds: currentMember.businessRegion });
      }
      if (memberStateId) {
        regionConditions.push({ stateIds: memberStateId });
      }
      if (regionMemberIds.length > 0) {
        regionConditions.push({ memberId: { $in: regionMemberIds } });
      }

      const visibilityOrArray: any[] = [];
      if (type === PostType.GIVE) {
        where.memberId = { $in: mutualIds };
      } else if (type === PostType.REQUIREMENT) {
        const reqRegionCondition: any = { requirementVisibility: RequirementVisibility.REGION };
        if (regionConditions.length > 0) {
          reqRegionCondition.$or = regionConditions;
        } else {
          // If no region info, prevent matching any region requirements
          reqRegionCondition._id = new ObjectId();
        }

        visibilityOrArray.push(
          { requirementVisibility: { $exists: false } },
          { requirementVisibility: null },
          { requirementVisibility: RequirementVisibility.OVERALL },
          { memberId: new ObjectId(userId) },
          { requirementVisibility: RequirementVisibility.MUTUAL_FRIEND, memberId: { $in: mutualIds } },
          reqRegionCondition
        );
      } else if (!type) {
        const reqRegionCondition: any = { type: PostType.REQUIREMENT, requirementVisibility: RequirementVisibility.REGION };
        if (regionConditions.length > 0) {
          reqRegionCondition.$or = regionConditions;
        } else {
          reqRegionCondition._id = new ObjectId();
        }

        visibilityOrArray.push(
          { type: { $ne: PostType.REQUIREMENT } },
          { type: PostType.REQUIREMENT, requirementVisibility: { $exists: false } },
          { type: PostType.REQUIREMENT, requirementVisibility: null },
          { type: PostType.REQUIREMENT, requirementVisibility: RequirementVisibility.OVERALL },
          { type: PostType.REQUIREMENT, memberId: new ObjectId(userId) },
          { type: PostType.REQUIREMENT, requirementVisibility: RequirementVisibility.MUTUAL_FRIEND, memberId: { $in: mutualIds } },
          reqRegionCondition
        );
      }

      if (memberId && ObjectId.isValid(memberId)) {
        where.memberId = new ObjectId(memberId);
      }

      if (search) {
        const searchOrArray = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } }
        ];

        if (visibilityOrArray.length > 0) {
          where.$and = [
            { $or: visibilityOrArray },
            { $or: searchOrArray }
          ];
        } else {
          where.$or = searchOrArray;
        }
      } else if (visibilityOrArray.length > 0) {
        where.$or = visibilityOrArray;
      }

      // Auto-apply logged-in member's businessRegion as region filter if set
      if (currentMember?.businessRegion) {
        const memberRegionId = new ObjectId(currentMember.businessRegion);
        const regionCondition = {
          $or: [
            { regionIds: { $exists: false } },
            { regionIds: null },
            { regionIds: { $size: 0 } },
            { regionIds: { $elemMatch: { $eq: memberRegionId } } }
          ]
        };

        if (where.$and) {
          where.$and.push(regionCondition);
        } else if (where.$or) {
          where.$and = [
            { $or: where.$or },
            regionCondition
          ];
          delete where.$or;
        } else {
          where.$or = regionCondition.$or;
        }
      }

      if (!currentMember) {
        throw new BadRequestError("Member not found");
      }
      this.applyCategoryVisibilityFilter(where, currentMember);

      const { reportedPostIds } = await this.getReportedDataForUser(userId);
      if (reportedPostIds.length > 0) {
        const ninPostCondition = { _id: { $nin: reportedPostIds } };
        if (where.$and) {
          where.$and.push(ninPostCondition);
        } else if (where.$or) {
          where.$and = [{ $or: where.$or }, ninPostCondition];
          delete where.$or;
        } else {
          where._id = { $nin: reportedPostIds };
        }
      }

      const allPosts = await this.postRepo.find({ where });
      const total = allPosts.length;

      // Random shuffle using Math.random() (Fisher-Yates shuffle algorithm)
      const shuffledPosts = [...allPosts];
      for (let i = shuffledPosts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledPosts[i], shuffledPosts[j]] = [shuffledPosts[j], shuffledPosts[i]];
      }

      const posts = shuffledPosts.slice(page * limit, (page + 1) * limit);

      // Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // Fetch Category Info for Members
      const categoryIds = [...new Set(members.map(m => m.businessCategory).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null
      }]));

      // Check which posts are saved by current user
      const savedPosts = await this.savedPostRepo.find({
        where: { memberId: new ObjectId(userId), postId: { $in: posts.map(p => p._id) } } as any
      });
      const savedPostIds = new Set(savedPosts.map(s => s.postId.toString()));

      const data = posts.map(p => ({
        ...p,
        member: memberMap.get(p.memberId.toString()) || null,
        isSaved: savedPostIds.has(p._id.toString())
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}:
   *   get:
   *     summary: Get post details by ID
   *     tags: [Mobile Post]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/:id([0-9a-fA-F]{24})")
  async getOne(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const post = await this.postRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false, status: { $ne: "reported" } }
      });

      if (!post) throw new NotFoundError("Post not found");

      // Validate category/subcategory visibility if requester is not the owner
      if (post.memberId.toString() !== userId) {
        const currentMember = await this.memberRepo.findOneBy({ _id: new ObjectId(userId) });
        if (!currentMember) throw new BadRequestError("Member not found");

        if (post.subCategoryIds && post.subCategoryIds.length > 0) {
          const memberSub = currentMember.subCategory ? currentMember.subCategory.toString() : null;
          const match = post.subCategoryIds.some(catId => catId.toString() === memberSub);
          if (!match) throw new BadRequestError("Post not found");
        } else if (post.categoryIds && post.categoryIds.length > 0) {
          const memberCat = currentMember.businessCategory ? currentMember.businessCategory.toString() : null;
          const match = post.categoryIds.some(catId => catId.toString() === memberCat);
          if (!match) throw new BadRequestError("Post not found");
        }
      }

      const member = await this.memberRepo.findOneBy({ _id: post.memberId });

      // Fetch categories & subcategories bulk for the single post and member
      const categoryIdsToFetch = new Set<string>();
      if (member && member.businessCategory) {
        categoryIdsToFetch.add(member.businessCategory.toString());
      }
      if (post.categoryIds) {
        post.categoryIds.forEach(id => categoryIdsToFetch.add(id.toString()));
      }
      if (post.subCategoryIds) {
        post.subCategoryIds.forEach(id => categoryIdsToFetch.add(id.toString()));
      }

      const uniqueCategoryIds = Array.from(categoryIdsToFetch).map(id => new ObjectId(id));
      const categoriesList = uniqueCategoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: uniqueCategoryIds } } as any })
        : [];
      const categoriesMap = new Map(categoriesList.map(c => [c._id.toString(), c.name]));

      const categories = post.categoryIds
        ? post.categoryIds.map(id => ({
          _id: id,
          name: categoriesMap.get(id.toString()) || ""
        }))
        : [];

      const subCategories = post.subCategoryIds
        ? post.subCategoryIds.map(id => ({
          _id: id,
          name: categoriesMap.get(id.toString()) || ""
        }))
        : [];

      // Check if saved
      const isSaved = !!(await this.savedPostRepo.findOneBy({
        memberId: new ObjectId(userId),
        postId: post._id
      }));

      const memberCategoryName = member && member.businessCategory ? (categoriesMap.get(member.businessCategory.toString()) || null) : null;

      const data = {
        ...post,
        member: member ? {
          _id: member._id,
          fullName: member.fullName,
          profilePhoto: member.profilePhoto,
          businessName: member.businessName,
          categoryName: memberCategoryName,
          businessCategoryName: memberCategoryName,
          businessCategory: memberCategoryName
        } : null,
        categories,
        subCategories,
        isSaved
      };

      return res.status(StatusCodes.OK).json({
        success: true,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}:
   *   put:
   *     summary: Update an existing post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdatePostDto'
   */
  @Put("/:id([0-9a-fA-F]{24})")
  async update(@Req() req: any, @Param("id") id: string, @Body() data: UpdatePostDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      // Only owner can update
      if (post.memberId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to update this post");
      }

      const targetType = data.type !== undefined ? data.type : post.type;
      const inputVisibility = data.requirementVisibility !== undefined ? data.requirementVisibility : (data as any).visibility;
      const finalVisibility = inputVisibility !== undefined ? inputVisibility : post.requirementVisibility;

      if (targetType === PostType.REQUIREMENT && !finalVisibility) {
        throw new BadRequestError("requirementVisibility is required when post type is REQUIREMENT");
      }
      if (inputVisibility !== undefined && inputVisibility !== null) {
        const normalized = inputVisibility.toUpperCase().trim().replace(/_|\s+/g, "-");
        const validValues = Object.values(RequirementVisibility);
        if (!validValues.includes(normalized as RequirementVisibility)) {
          throw new BadRequestError(`Invalid requirementVisibility. Must be one of: ${validValues.join(", ")}`);
        }
        data.requirementVisibility = normalized as RequirementVisibility;
      }

      // If visibility is OVERALL, clear all scoping ID fields
      if (data.requirementVisibility === RequirementVisibility.OVERALL) {
        data.stateIds = [];
        data.regionIds = [];
        data.categoryIds = [];
        data.subCategoryIds = [];
      }

      Object.assign(post, data);

      const inputStateIds = data.stateIds || (data as any).states;
      if (Array.isArray(inputStateIds)) {
        post.stateIds = inputStateIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }

      const inputRegionIds = data.regionIds || (data as any).regions;
      if (Array.isArray(inputRegionIds)) {
        post.regionIds = inputRegionIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }

      if (Array.isArray(data.categoryIds)) {
        post.categoryIds = data.categoryIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }
      if (Array.isArray(data.subCategoryIds)) {
        post.subCategoryIds = data.subCategoryIds
          .map(getObjectIdStr)
          .filter((id): id is string => !!id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }

      // Remove any legacy unmapped keys so they don't persist in DB
      delete (post as any).visibility;
      delete (post as any).states;
      delete (post as any).regions;
      const saved = await this.postRepo.save(post);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}:
   *   delete:
   *     summary: Delete a post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Delete("/:id([0-9a-fA-F]{24})")
  async delete(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = req.user.userId;

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      // Only owner can delete
      if (post.memberId.toString() !== userId) {
        throw new BadRequestError("You are not authorized to delete this post");
      }

      post.isDeleted = true;
      await this.postRepo.save(post);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}/share:
   *   post:
   *     summary: Increment sharedCount of a post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               receiverId:
   *                 type: string
   */
  private async isMutualFriend(userId1: ObjectId, userId2: ObjectId): Promise<boolean> {
    if (userId1.equals(userId2)) return true;
    const [conn1, conn2] = await Promise.all([
      this.connectionRepo.findOne({
        where: { senderId: userId1, receiverId: userId2, status: ConnectionStatus.ACCEPTED, isDeleted: false } as any
      }),
      this.connectionRepo.findOne({
        where: { senderId: userId2, receiverId: userId1, status: ConnectionStatus.ACCEPTED, isDeleted: false } as any
      })
    ]);
    return !!(conn1 && conn2);
  }

  private async isBlocked(userA: ObjectId, userB: ObjectId): Promise<boolean> {
    const blockedConnection = await this.connectionRepo.findOne({
      where: {
        $or: [
          { senderId: userA, receiverId: userB, status: ConnectionStatus.BLOCKED },
          { senderId: userB, receiverId: userA, status: ConnectionStatus.BLOCKED }
        ],
        isDeleted: false
      } as any
    });
    if (blockedConnection) return true;

    const reportedConversation = await this.conversationRepo.findOne({
      where: {
        participants: { $all: [userA, userB] },
        status: "REPORTED"
      } as any
    });
    if (reportedConversation) return true;

    const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
    const reportedHistory = await reportedHistoryRepo.findOne({
      where: {
        $or: [
          { reporterUserId: userA, targetUserId: userB },
          { reporterUserId: userB, targetUserId: userA }
        ]
      } as any
    });
    if (reportedHistory) return true;

    return false;
  }

  @Post("/:id/share")
  async share(@Req() req: any, @Param("id") id: string, @Body() body: { receiverId: string, message: string }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const { receiverId, message } = body;

      if (!receiverId || !ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid or missing receiverId");
      }

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      const recId = new ObjectId(receiverId);
      const isMutual = await this.isMutualFriend(userId, recId);
      const isBlockedMember = await this.isBlocked(userId, recId);

      // Find or Create conversation between userId and receiverId
      let targetConversation = await this.conversationRepo.findOne({
        where: {
          participants: { $all: [userId, recId] }
        } as any,
        order: { updatedAt: "DESC" }
      });

      if (targetConversation) {
        // Check if already shared or responded to this post in this conversation by this user
        const existingShare = await this.messageRepo.findOne({
          where: {
            conversationId: targetConversation._id,
            senderId: userId,
            postId: post._id,
            type: { $in: [MessageType.POST_SHARE, MessageType.POST_RESPONSE] }
          } as any
        });

        if (existingShare) {
          return res.status(StatusCodes.OK).json({
            success: true,
            message: "You have already shared this post with this member",
            sharedCount: post.sharedCount || 0,
            conversationId: targetConversation._id,
            existingShare
          });
        }

        targetConversation.postId = post._id;
        const wasRejectedOrDeleted =
          targetConversation.status === "REJECTED" ||
          targetConversation.status === "DELETED" ||
          targetConversation.isDeleted ||
          !!targetConversation.deletedBy;

        if (wasRejectedOrDeleted) {
          targetConversation.status = "PENDING";
          targetConversation.isDeleted = false;
          delete targetConversation.deletedBy;
        } else if (targetConversation.status === "PENDING" && isMutual) {
          targetConversation.status = "ACCEPTED";
        }
        await this.conversationRepo.save(targetConversation);
      } else {
        targetConversation = new Conversation();
        targetConversation.participants = [userId, recId];
        targetConversation.postId = post._id;
        targetConversation.status = isMutual ? "ACCEPTED" : "PENDING";
        targetConversation.unreadCounts = {};
        targetConversation = await this.conversationRepo.save(targetConversation);
      }

      // Increment share count
      post.sharedCount = (post.sharedCount || 0) + 1;
      await this.postRepo.save(post);

      // If targetConversation is found or created, send the post into the chat
      if (targetConversation) {
        const otherId = targetConversation.participants.find(p => !p.equals(userId));
        if (!otherId) throw new BadRequestError("No receiver found in this conversation");

        const newMessage = new Message();
        newMessage.conversationId = targetConversation._id;
        newMessage.senderId = userId;
        newMessage.content = message;
        newMessage.type = MessageType.POST_SHARE;
        newMessage.postId = post._id;
        newMessage.isRead = false;
        if (isBlockedMember && otherId) {
          newMessage.blockedFor = [otherId];
        }
        // Check if receiver is in the chat room
        const isReceiverActive = !isBlockedMember && isUserInConversation(otherId.toString(), targetConversation._id.toString());
        if (isReceiverActive) {
          newMessage.isRead = true;
        }

        await this.messageRepo.save(newMessage);

        // Update conversation last message and unread count
        targetConversation.lastMessage = message;
        targetConversation.lastMessageTime = new Date();
        targetConversation.lastMessageSenderId = userId;

        // Update unread count for receiver only if not blocked
        if (!isBlockedMember) {
          const unreadCounts = targetConversation.unreadCounts || {};
          if (isReceiverActive) {
            unreadCounts[otherId.toString()] = 0;
          } else {
            unreadCounts[otherId.toString()] = (unreadCounts[otherId.toString()] || 0) + 1;
          }
          targetConversation.unreadCounts = { ...unreadCounts };
        }

        await this.conversationRepo.save(targetConversation);

        const io = getIO();
        if (otherId && !isBlockedMember) {
          const populatedMessage = {
            ...newMessage,
            isMe: false,
            post: post
          };
          io.to(otherId.toString()).emit("new_message", populatedMessage);

          // Emit conversation update for the conversation list screen
          const sender = await this.memberRepo.findOneBy({ _id: userId });
          let senderCategoryName = null;
          if (sender && sender.businessCategory) {
            const cat = await this.categoryRepo.findOneBy({ _id: sender.businessCategory });
            senderCategoryName = cat ? cat.name : null;
          }

          const unreadCount = targetConversation.unreadCounts?.[otherId.toString()] || 0;

          io.to(otherId.toString()).emit("conversation_updated", {
            ...targetConversation,
            lastMessage: message,
            lastMessageTime: targetConversation.lastMessageTime,
            lastMessageSenderId: userId,
            otherUser: sender ? {
              _id: sender._id,
              fullName: sender.fullName,
              profilePhoto: sender.profilePhoto,
              categoryName: senderCategoryName
            } : null,
            post: post,
            unreadCount
          });

          // Send Push Notification if receiver is not active in the chat room and has fcmToken
          const receiver = await this.memberRepo.findOneBy({ _id: otherId, isDeleted: false });
          if (!isReceiverActive && receiver?.fcmToken) {
            const senderName = sender?.fullName ? sender.fullName.trim() : "A member";
            await insertPushNotification({
              token: receiver.fcmToken,
              subject: `New Shared Post from ${senderName}`,
              content: message || `${senderName} shared a post with you.`,
              moduleName: NotificationModule.MESSAGE,
              moduleId: targetConversation._id.toString(),
              receiverId: receiver._id.toString(),
              senderId: userId.toString()
            });
          }
        }

        // Emit conversation update to sender
        const receiverMember = await this.memberRepo.findOneBy({ _id: recId });
        let receiverCategoryName = null;
        if (receiverMember && receiverMember.businessCategory) {
          const cat = await this.categoryRepo.findOneBy({ _id: receiverMember.businessCategory });
          receiverCategoryName = cat ? cat.name : null;
        }
        io.to(userId.toString()).emit("conversation_updated", {
          ...targetConversation,
          lastMessage: message,
          lastMessageTime: targetConversation.lastMessageTime,
          lastMessageSenderId: userId,
          otherUser: receiverMember ? {
            _id: receiverMember._id,
            fullName: receiverMember.fullName,
            profilePhoto: receiverMember.profilePhoto,
            categoryName: receiverCategoryName
          } : null,
          post: post,
          unreadCount: targetConversation.unreadCounts?.[userId.toString()] || 0
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post shared successfully",
        sharedCount: post.sharedCount,
        conversationId: targetConversation?._id
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}/save:
   *   post:
   *     summary: Save a post to bookmarks
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Post("/:id/save")
  async savePost(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const postId = new ObjectId(id);

      const post = await this.postRepo.findOneBy({ _id: postId, isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      const existing = await this.savedPostRepo.findOneBy({ memberId: userId, postId });
      if (existing) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Post already saved"
        });
      }

      const savedPost = new SavedPost();
      savedPost.memberId = userId;
      savedPost.postId = postId;
      await this.savedPostRepo.save(savedPost);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post saved to bookmarks"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}/unsave:
   *   post:
   *     summary: Remove a post from bookmarks
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Post("/:id/unsave")
  async unsavePost(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const postId = new ObjectId(id);

      await this.savedPostRepo.deleteMany({ memberId: userId, postId });

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Post removed from bookmarks"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/saved/list:
   *   get:
   *     summary: Get all saved posts of the logged-in member
   *     tags: [Mobile Post]
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
   */
  @Get("/saved/list")
  async getSavedPosts(@Req() req: any, @QueryParam("page") page: number, @QueryParam("limit") limit: number, @Res() res: any) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;
    try {
      const userId = new ObjectId(req.user.userId);

      const [savedEntries, total] = await this.savedPostRepo.findAndCount({
        where: { memberId: userId },
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      const postIds = savedEntries.map(s => s.postId);
      const rawPosts = postIds.length > 0
        ? await this.postRepo.find({ where: { _id: { $in: postIds }, isDeleted: false } as any })
        : [];

      const { reportedPostIds } = await this.getReportedDataForUser(req.user.userId);
      const reportedPostSet = new Set(reportedPostIds.map((id: ObjectId) => id.toString()));
      const posts = rawPosts.filter(
        p => !reportedPostSet.has(p._id?.toString())
      );

      // Populate Member Info for the posts
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      // Fetch Category Info for Members
      const categoryIds = [...new Set(members.map(m => m.businessCategory).filter((id): id is ObjectId => !!id))];
      const categories = categoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: categoryIds } } as any })
        : [];

      const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null,
        businessCategory: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) || null : null
      }]));

      const postMap = new Map(posts.map(p => [p._id.toString(), p]));

      const data = savedEntries
        .map(s => {
          const p = postMap.get(s.postId.toString());
          if (!p) return null;
          return {
            ...p,
            member: memberMap.get(p.memberId.toString()) || null,
            isSaved: true
          };
        })
        .filter(p => p !== null) as any[];

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/posts/{id}/report:
   *   post:
   *     summary: Report a post
   *     tags: [Mobile Post]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - reason
   *             properties:
   *               reason:
   *                 type: string
   *                 example: "Spam or misleading"
   *               comments:
   *                 type: string
   *                 example: "This post is selling fake items."
   */
  @Post("/:id/report")
  async reportPost(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { reason: string; comments?: string },
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const postId = new ObjectId(id);
      const { reason, comments } = body;

      if (!reason || typeof reason !== "string" || reason.trim() === "") {
        throw new BadRequestError("Reason is required and must be a non-empty string");
      }

      // 1. Check if post exists and is not deleted
      const post = await this.postRepo.findOneBy({ _id: postId, isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      // 2. Prevent self-reporting
      if (post.memberId.equals(userId)) {
        throw new BadRequestError("You cannot report your own post");
      }

      // 3. Prevent duplicate reports
      const postReportRepo = AppDataSource.getMongoRepository(PostReport);
      const existingReport = await postReportRepo.findOne({
        where: {
          reporterId: userId,
          postId: postId
        } as any
      });

      if (existingReport) {
        throw new BadRequestError("You have already reported this post");
      }

      // 4. Save reported history
      const report = new PostReport();
      report.reporterId = userId;
      report.postId = postId;
      report.reason = reason;
      report.comments = comments;

      const savedReport = await postReportRepo.save(report);

      // 5. Count total reports for this post and block if >= 10
      const reportCount = await postReportRepo.count({ postId } as any);
      if (reportCount >= 10) {
        post.status = "reported";
        await this.postRepo.save(post);
        console.log(`[PostReport] Post ${postId} reached ${reportCount} reports. Status updated to 'reported'.`);
      }

      return res.status(StatusCodes.OK).json({
        message: "Post reported successfully",
        data: savedReport
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * Helper method to get ObjectIds of posts reported by the current user.
   */
  private async getReportedDataForUser(userId: string): Promise<{
    reportedPostIds: ObjectId[];
    reportedMemberIds: ObjectId[];
  }> {
    try {
      const userObjectId = new ObjectId(userId);
      const postReportRepo = AppDataSource.getMongoRepository(PostReport);

      // 1. Specific posts reported by this user
      const postReports = await postReportRepo.find({
        where: { reporterId: userObjectId } as any
      });
      const reportedPostIds = postReports.map(r => r.postId);

      return { reportedPostIds, reportedMemberIds: [] };
    } catch (error) {
      console.error("[getReportedDataForUser] Error:", error);
      return { reportedPostIds: [], reportedMemberIds: [] };
    }
  }
}
