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
import { PointService } from "../../services/point.service";
import { PointConfigType } from "../../entity/PointConfig";
import { DailyScoreService } from "../../services/dailyScore.service";
import { notifyPostAudience } from "../../services/pushnotification.service";

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
        // Notify relevant members about the new post (non-blocking)
        notifyPostAudience({
          post: savedPost,
          senderId: userId,
          subject: `New ${data.type.charAt(0) + data.type.slice(1).toLowerCase()} Post`,
          content: "A new post has been shared"
        }).catch(err => console.error("[PostController] notifyPostAudience error:", err));
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
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
      });

      console.log(`User ${userId} is following ${followings.length} members`);

      // Ensure all IDs are fresh ObjectIds for the Mongo query
      const followingIds = followings.map(f => new ObjectId(f.receiverId));

      // // Include own posts in the feed
      // followingIds.push(new ObjectId(userId));

      const reportedUserIds = await this.getReportedMemberIdsForUser(userId);
      const reportedSet = new Set(reportedUserIds.map(id => id.toString()));
      const filteredFollowingIds = followingIds.filter(id => !reportedSet.has(id.toString()));

      // 2. Fetch posts from these members
      const where: any = {
        memberId: { $in: filteredFollowingIds },
        isDeleted: false,
        status: { $ne: "reported" }
      };

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
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
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
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
      });
      const followingIds = following.map(f => f.receiverId.toString());

      const followers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
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
        memberId: { $ne: new ObjectId(userId) }
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
      // console.log(JSON.stringify(where), 'where')
      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // 4. Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName,
        city: m.city,
        businessRegion: m.businessRegion
      }]));

      // Fetch categories & subcategories bulk
      const categoryIdsToFetch = new Set<string>();
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
      const reportedUserIds = await this.getReportedMemberIdsForUser(userId);
      const excludedMemberIds = [new ObjectId(userId), ...reportedUserIds];
      const where: any = {
        isDeleted: false,
        status: { $ne: "reported" },
        memberId: { $nin: excludedMemberIds }
      };

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

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

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
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
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
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
      });
      const followingIds = following.map(f => f.receiverId.toString());

      const followers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
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

      const reportedUserIds = await this.getReportedMemberIdsForUser(userId);
      if (reportedUserIds.length > 0) {
        const ninCondition = { memberId: { $nin: reportedUserIds } };
        where.$and = [...(where.$and || []), ninCondition];
      }

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

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
        categoryName: m.businessCategory ? categoryMap.get(m.businessCategory.toString()) : null
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
      const where: any = { isDeleted: false, status: { $ne: "reported" } };

      if (type) where.type = type;

      // 1. Find who current user follows (needed for GIVE and REQUIREMENT target filters)
      const following = await this.connectionRepo.find({
        where: { senderId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
      });
      const followingIds = following.map(f => f.receiverId.toString());

      // 2. Find who follows current user
      const followers = await this.connectionRepo.find({
        where: { receiverId: new ObjectId(userId), status: ConnectionStatus.ACCEPTED }
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

      const reportedUserIds = await this.getReportedMemberIdsForUser(userId);
      if (reportedUserIds.length > 0) {
        const ninCondition = { memberId: { $nin: reportedUserIds } };
        if (where.$and) {
          where.$and.push(ninCondition);
        } else if (where.$or) {
          where.$and = [{ $or: where.$or }, ninCondition];
          delete where.$or;
        } else {
          where.memberId = where.memberId
            ? { ...where.memberId, $nin: reportedUserIds }
            : { $nin: reportedUserIds };
        }
      }

      const [posts, total] = await this.postRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      // Populate Member Info
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName
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

        // if (post.subCategoryIds && post.subCategoryIds.length > 0) {
        //   const memberSub = currentMember.subCategory ? currentMember.subCategory.toString() : null;
        //   const match = post.subCategoryIds.some(catId => catId.toString() === memberSub);
        //   if (!match) throw new BadRequestError("You do not have access to view this post");
        // } else if (post.categoryIds && post.categoryIds.length > 0) {
        //   const memberCat = currentMember.businessCategory ? currentMember.businessCategory.toString() : null;
        //   const match = post.categoryIds.some(catId => catId.toString() === memberCat);
        //   if (!match) throw new BadRequestError("You do not have access to view this post");
        // }
      }

      const member = await this.memberRepo.findOneBy({ _id: post.memberId });

      // Fetch categories & subcategories bulk for the single post
      const categoryIdsToFetch = new Set<string>();
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

      const data = {
        ...post,
        member: member ? {
          _id: member._id,
          fullName: member.fullName,
          profilePhoto: member.profilePhoto,
          businessName: member.businessName
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
  @Post("/:id/share")
  async share(@Req() req: any, @Param("id") id: string, @Body() body: { receiverId: string }, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");
      const userId = new ObjectId(req.user.userId);
      const { receiverId } = body;

      if (!receiverId || !ObjectId.isValid(receiverId)) {
        throw new BadRequestError("Invalid or missing receiverId");
      }

      const post = await this.postRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!post) throw new NotFoundError("Post not found");

      const recId = new ObjectId(receiverId);
      // Find or Create conversation between userId and receiverId specific to this post
      let targetConversation = await this.conversationRepo.findOne({
        where: {
          participants: { $all: [userId, recId] },
          postId: post._id
        } as any
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
      } else {
        targetConversation = new Conversation();
        targetConversation.participants = [userId, recId];
        targetConversation.postId = post._id;
        targetConversation.status = "PENDING";
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
        newMessage.content = "Shared a post";
        newMessage.type = MessageType.POST_SHARE;
        newMessage.postId = post._id;
        newMessage.isRead = false;
        // Check if receiver is in the chat room
        const isReceiverActive = isUserInConversation(otherId.toString(), targetConversation._id.toString());
        if (isReceiverActive) {
          newMessage.isRead = true;
        }

        await this.messageRepo.save(newMessage);

        // Update conversation last message and unread count
        targetConversation.lastMessage = "Shared a post";
        targetConversation.lastMessageTime = new Date();
        targetConversation.lastMessageSenderId = userId;

        // Update unread count for receiver
        const unreadCounts = targetConversation.unreadCounts || {};
        if (isReceiverActive) {
          unreadCounts[otherId.toString()] = 0;
        } else {
          unreadCounts[otherId.toString()] = (unreadCounts[otherId.toString()] || 0) + 1;
        }
        targetConversation.unreadCounts = { ...unreadCounts };

        await this.conversationRepo.save(targetConversation);

        // Socket Notification
        if (otherId) {
          const io = getIO();
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
            lastMessage: "Shared a post",
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
        }
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

      const reportedUserIds = await this.getReportedMemberIdsForUser(req.user.userId);
      const reportedSet = new Set(reportedUserIds.map(id => id.toString()));
      const posts = rawPosts.filter(p => !reportedSet.has(p.memberId?.toString()));

      // Populate Member Info for the posts
      const memberIds = [...new Set(posts.map(p => p.memberId))];
      const members = memberIds.length > 0
        ? await this.memberRepo.find({ where: { _id: { $in: memberIds } } as any })
        : [];

      const memberMap = new Map(members.map(m => [m._id.toString(), {
        _id: m._id,
        fullName: m.fullName,
        profilePhoto: m.profilePhoto,
        businessName: m.businessName
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
      const reportCount = await postReportRepo.count({ where: { postId } as any });
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
   * Helper method to get ObjectIds of members reported by the current user (via profile/chat report).
   */
  private async getReportedMemberIdsForUser(userId: string): Promise<ObjectId[]> {
    try {
      const userObjectId = new ObjectId(userId);
      const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
      const conversationRepo = AppDataSource.getMongoRepository(Conversation);

      // 1. User profile reports from ReportedHistory
      const historyReports = await reportedHistoryRepo.find({
        where: { reporterUserId: userObjectId } as any
      });
      const historyUserIds = historyReports.map(r => r.targetUserId.toString());

      // 2. Chat user reports from Conversation
      const chatReports = await conversationRepo.find({
        where: { reportedBy: userObjectId, status: "REPORTED" } as any
      });
      const chatUserIds = chatReports.flatMap(c =>
        c.participants.filter(p => !p.equals(userObjectId)).map(p => p.toString())
      );

      const uniqueIds = [...new Set([...historyUserIds, ...chatUserIds])];
      return uniqueIds.map(id => new ObjectId(id));
    } catch (error) {
      console.error("[getReportedMemberIdsForUser] Error:", error);
      return [];
    }
  }
}
