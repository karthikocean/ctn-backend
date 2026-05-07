import {
  JsonController,
  Get,
  QueryParam,
  Res
} from "routing-controllers";
import axios from "axios";
import { AppDataSource } from "../../data-source";
import { Category, CategoryStatus } from "../../entity/Category";
import { ObjectId } from "mongodb";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/common")
export class CommonController {
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /mobile-api/common/categories:
   *   get:
   *     summary: Get all active categories
   *     tags: [Mobile Common]
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
}
