import {
  JsonController,
  Get,
  QueryParam,
  Res
} from "routing-controllers";
import axios from "axios";
import { AppDataSource } from "../../data-source";
import { Category, CategoryStatus } from "../../entity/Category";
import { MarketplaceCategory, MarketplaceCategoryStatus } from "../../entity/MarketplaceCategory";
import { ObjectId } from "mongodb";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { BusinessRegion } from "../../entity/BusinessRegion";
import { Member, MemberStatus } from "../../entity/Member";
import { State } from "../../entity/State";
import { City } from "../../entity/City";

@JsonController("/common")
export class CommonController {
  private categoryRepo = AppDataSource.getMongoRepository(Category);
  private marketplaceCategoryRepo = AppDataSource.getMongoRepository(MarketplaceCategory);

  /**
   * @swagger
   * /mobile-api/common/categories:
   *   get:
   *     summary: Get all active categories
   *     tags: [Mobile Common]
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
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [MAIN, SUB, REFERRAL]
   *       - in: query
   *         name: parentId
   *         schema:
   *           type: string
   */
  @Get("/categories")
  async getCategories(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("type") type: string,
    @QueryParam("parentId") parentId: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = {
        isDeleted: false,
        status: CategoryStatus.ACTIVE
      };

      if (search) {
        where.name = { $regex: search, $options: "i" };
      }
      if (type) {
        where.type = type;
      }
      if (parentId) {
        where.parentCategory = new ObjectId(parentId);
      }

      const [categories, total] = await this.categoryRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { name: "ASC" }
      });

      // ✅ Manual Population for cleaner response
      const allCategoryIds = categories
        .flatMap(c => [c.parentCategory, c.referralParent])
        .filter((id): id is ObjectId => !!id);

      const parents = allCategoryIds.length > 0
        ? await this.categoryRepo.find({ where: { _id: { $in: allCategoryIds } } as any })
        : [];

      const parentMap = new Map(parents.map(p => [p._id.toString(), { _id: p._id, name: p.name }]));

      // ✅ Get counts for Sub and Referral categories
      const categoryIds = categories.map(c => c._id);
      const subCounts = await this.categoryRepo.aggregate([
        { $match: { parentCategory: { $in: categoryIds }, isDeleted: false, status: CategoryStatus.ACTIVE } },
        { $group: { _id: "$parentCategory", count: { $sum: 1 } } }
      ]).toArray();

      const referralCounts = await this.categoryRepo.aggregate([
        { $match: { referralParent: { $in: categoryIds }, isDeleted: false, status: CategoryStatus.ACTIVE } },
        { $group: { _id: "$referralParent", count: { $sum: 1 } } }
      ]).toArray();

      const subCountMap = new Map(subCounts.map(s => [s._id.toString(), s.count]));
      const referralCountMap = new Map(referralCounts.map(r => [r._id.toString(), r.count]));

      const data = categories.map(c => ({
        ...c,
        parentCategory: c.parentCategory ? parentMap.get(c.parentCategory.toString()) : null,
        referralParent: c.referralParent ? parentMap.get(c.referralParent.toString()) : null,
        subCategoryCount: subCountMap.get(c._id.toString()) || 0,
        referralCount: referralCountMap.get(c._id.toString()) || 0
      }));

      return pagination(total, data, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile/common/verify-gst:
   *   get:
   *     summary: Verify GST number (Placeholder for Gov/Third-party API)
   *     tags: [Mobile Common]
   *     parameters:
   *       - in: query
   *         name: gstin
   *         required: true
   *         schema:
   *           type: string
   *           example: "27AAACV9003N1Z2"
   *     responses:
   *       200:
   *         description: GST verification results
   */
  @Get("/verify-gst")
  async verifyGST(@QueryParam("gstin") gstin: string, @Res() res: any) {
    if (!gstin) {
      return res.status(400).json({ status: false, message: "GSTIN is required" });
    }

    // ✅ Basic GSTIN Format Validation (India)
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(gstin)) {
      return res.status(400).json({ status: false, message: "Invalid GSTIN format" });
    }

    try {
      const apiKey = process.env.GSTIN_CHECK_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ status: false, message: "GST API key not configured" });
      }

      const response = await axios.get(`https://sheet.gstincheck.co.in/check/${apiKey}/${gstin}`);

      if (response.data && response.data.flag) {
        const gstData = response.data.data;

        const formattedData = {
          gstNumber: gstData.gstin,
          businessName: gstData.tradeNam || gstData.lgnm,
          legalName: gstData.lgnm,
          gstStatus: gstData.sts,
          businessType: gstData.ctb,
          taxpayerType: gstData.dty,
          registrationDate: gstData.rgdt,
          address: gstData.pradr?.adr || "",
          pincode: gstData.pradr?.addr?.pncd || "",
          state: gstData.pradr?.addr?.stcd || "",
          district: gstData.pradr?.addr?.dst || "",
          natureOfBusiness: gstData.nba || []
        };
        return res.status(200).json({
          status: true,
          message: "GSTIN verified successfully",
          data: formattedData
        });
      } else {
        return res.status(400).json({
          status: false,
          message: response.data?.message || "GSTIN verification failed",
          error: response.data
        });
      }
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/business-region")
  async getBusinessRegion(@QueryParam("state") state: string, @QueryParam("city") city: string, @Res() res: any) {
    try {
      if (!state || !city) {
        return res.status(400).json({
          status: false,
          message: "state and city are required"
        });
      }

      const businessRegionRepository = AppDataSource.getMongoRepository(BusinessRegion);
      const memberRepository = AppDataSource.getMongoRepository(Member);
      const stateRepo = AppDataSource.getMongoRepository(State);
      const cityRepo = AppDataSource.getMongoRepository(City);

      const stateDoc = await stateRepo.findOne({
        where: { name: { $regex: new RegExp(`^${state}$`, "i") }, isDeleted: false }
      });

      let businessRegion = null;
      if (stateDoc) {
        const cityDoc = await cityRepo.findOne({
          where: { name: { $regex: new RegExp(`^${city}$`, "i") }, stateId: stateDoc._id, isDeleted: false }
        });
        if (cityDoc) {
          businessRegion = await businessRegionRepository.findOne({
            where: { state: stateDoc._id, city: cityDoc._id, isDeleted: false }
          });
        }
      }

      const areaCounts = await memberRepository.aggregate([
        {
          $match: {
            state: { $regex: new RegExp(`^${state}$`, "i") },
            city: { $regex: new RegExp(`^${city}$`, "i") },
            status: MemberStatus.ACTIVE,
            isDeleted: false,
            businessRegion: { $ne: null }
          }
        },
        {
          $group: {
            _id: "$businessRegion",
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      const countMap = new Map<string, number>();
      if (areaCounts) {
        areaCounts.forEach((item: any) => {
          if (item._id) {
            countMap.set(item._id.toString(), item.count);
          }
        });
      }

      const areas = businessRegion?.areas || [];
      const areasWithCounts = areas.map((area: any) => {
        const areaIdStr = area._id ? area._id.toString() : "";
        return {
          _id: area._id,
          name: area.name,
          memberCount: countMap.get(areaIdStr) || 0
        };
      });

      return res.status(200).json({
        status: true,
        message: businessRegion
          ? "Business region found successfully"
          : "No matching business region found",
        data: {
          state,
          city,
          areas: areasWithCounts,
        }
      });
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/common/states:
   *   get:
   *     summary: Get all states (with _id for multi-select filtering)
   *     tags: [Mobile Common]
   *     responses:
   *       200:
   *         description: List of state objects
   */
  @Get("/states")
  async getStates(@Res() res: any) {
    try {
      const stateRepository = AppDataSource.getMongoRepository(State);
      const states = await stateRepository.find({
        where: { isDeleted: false },
        order: { name: "ASC" } as any
      });

      // Deduplicate by name (keep first occurrence)
      const seen = new Set<string>();
      const uniqueStates = states
        .filter(s => s.name)
        .filter(s => {
          const key = s.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(s => ({
          _id: s._id,
          name: s.name,
          country: s.country
        }));

      return res.status(200).json({
        success: true,
        data: uniqueStates
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/common/business-regions:
   *   get:
   *     summary: Get business regions (cities + areas) filtered by selected state IDs
   *     tags: [Mobile Common]
   *     parameters:
   *       - in: query
   *         name: stateIds
   *         schema:
   *           type: string
   *         description: Comma-separated list of state ObjectIds (from /states API)
   *       - in: query
   *         name: states
   *         schema:
   *           type: string
   *         description: Comma-separated list of state names (fallback filter)
   *     responses:
   *       200:
   *         description: List of regions grouped by city
   */
  @Get("/business-regions")
  async getBusinessRegions(
    @QueryParam("stateIds") stateIds: string,
    @QueryParam("states") states: string,
    @Res() res: any
  ) {
    try {
      const businessRegionRepository = AppDataSource.getMongoRepository(BusinessRegion);
      const stateRepo = AppDataSource.getMongoRepository(State);
      const cityRepo = AppDataSource.getMongoRepository(City);

      let filterStateIds: ObjectId[] = [];

      // Primary filter: stateIds (comma-separated ObjectId strings)
      if (stateIds) {
        const idList = stateIds.split(",").map(s => s.trim()).filter(Boolean);
        filterStateIds = idList
          .filter(id => ObjectId.isValid(id))
          .map(id => new ObjectId(id));
      }

      // Fallback filter: state names
      if (filterStateIds.length === 0 && states) {
        const nameList = states.split(",").map(s => s.trim()).filter(Boolean);
        const stateConditions = nameList.map(s => ({
          name: { $regex: new RegExp(`^${s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
          isDeleted: false
        }));
        if (stateConditions.length > 0) {
          const matchingStates = await stateRepo.find({ where: { $or: stateConditions } as any });
          filterStateIds = matchingStates.map(s => s._id);
        }
      }

      // Build query
      const where: any = { isDeleted: false, status: "active" };
      if (filterStateIds.length > 0) {
        where.state = { $in: filterStateIds };
      }

      const regions = await businessRegionRepository.find({ where });

      // Resolve state and city names
      const allStateIds = [...new Set(regions.map(r => r.state?.toString()).filter(Boolean))];
      const allCityIds = [...new Set(regions.map(r => r.city?.toString()).filter(Boolean))];

      const stateDocsRaw = allStateIds.length > 0
        ? await stateRepo.find({ where: { _id: { $in: allStateIds.map(id => new ObjectId(id)) } } as any })
        : [];
      const cityDocsRaw = allCityIds.length > 0
        ? await cityRepo.find({ where: { _id: { $in: allCityIds.map(id => new ObjectId(id)) } } as any })
        : [];

      const stateMap = new Map(stateDocsRaw.map(s => [s._id.toString(), { _id: s._id, name: s.name, country: s.country }]));
      const cityMap = new Map(cityDocsRaw.map(c => [c._id.toString(), { _id: c._id, name: c.name }]));

      // Flatten all areas into a single combined array
      const combinedAreas: any[] = [];

      for (const region of regions) {
        const stateInfo = stateMap.get(region.state?.toString() ?? "");
        const cityInfo = cityMap.get(region.city?.toString() ?? "");

        if (region.areas && Array.isArray(region.areas)) {
          for (const area of region.areas) {
            combinedAreas.push({
              _id: area._id,
              name: area.name,
              city: cityInfo ?? { _id: region.city, name: "" },
              state: stateInfo ?? { _id: region.state, name: "" },
              country: region.country
            });
          }
        }
      }

      const result = combinedAreas.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/common/marketplace-categories:
   *   get:
   *     summary: Get all active marketplace categories
   *     tags: [Mobile Common]
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
  @Get("/marketplace-categories")
  async getMarketplaceCategories(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = {
        isDeleted: false,
        status: MarketplaceCategoryStatus.ACTIVE
      };

      if (search) {
        where.name = { $regex: search, $options: "i" };
      }

      const [categories, total] = await this.marketplaceCategoryRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { name: "ASC" }
      });

      return pagination(total, categories, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
