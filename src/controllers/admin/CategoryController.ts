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
  UseBefore,
  Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Category, CategoryType, CategoryStatus } from "../../entity/Category";
import { Member } from "../../entity/Member";
import { CreateCategoryDto, UpdateCategoryDto } from "../../dto/admin/Category.dto";
import * as XLSX from "xlsx";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { hasPermission } from "../../utils/common.function";

@JsonController("/categories")
@UseBefore(AuthMiddleware)
export class CategoryController {
  private categoryRepo = AppDataSource.getMongoRepository(Category);

  /**
   * @swagger
   * /api/admin/categories:
   *   post:
   *     summary: Create a new category
   *     tags: [Category]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateCategoryDto'
   *     responses:
   *       201:
   *         description: Category created successfully
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateCategoryDto, @Res() res: any, @Req() req: any) {
    try {
      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (data.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (data.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (data.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "create"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }
      const catExists = await this.categoryRepo.findOne({
        where: {
          name: { $regex: new RegExp(`^${data.name}$`, "i") },
          type: data.type,
          isDeleted: false
        }
      });
      console.log(catExists, "catExists");

      if (catExists) {
        throw new BadRequestError("Category with this name already exists");
      }
      const category = new Category();
      category.name = data.name;
      category.type = data.type;
      category.status = data.status || category.status;
      category.isDeleted = false;

      if (data.type === CategoryType.SUB && data.parentCategory) {
        category.parentCategory = new ObjectId(data.parentCategory);
      }

      if (data.type === CategoryType.REFERRAL && data.referralParent) {
        category.referralParent = new ObjectId(data.referralParent);
      }

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.CREATED).json(saved);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories/import:
   *   post:
   *     summary: Bulk import categories and subcategories from an Excel file
   *     tags: [Category]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: Categories imported successfully
   */
  @Post("/import")
  @HttpCode(StatusCodes.OK)
  async import(@Req() req: any, @Res() res: any) {
    try {
      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";

      // Requires permission to create categories
      if (!isSuperAdmin && !(await hasPermission(role, "main_categories", "create")) && !(await hasPermission(role, "sub_categories", "create"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions to import categories"
        });
      }

      if (!req.files || !req.files.file) {
        throw new BadRequestError("No file uploaded. Please upload a file with the key 'file'.");
      }

      const file = req.files.file;
      const workbook = XLSX.read(file.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(sheet);

      let createdMainCount = 0;
      let createdSubCount = 0;
      let skippedCount = 0;

      for (const row of jsonData) {
        let mainCategoryName = "";
        let subCategoryName = "";

        for (const key of Object.keys(row)) {
          const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "");
          if (normalizedKey === "maincategory" || normalizedKey === "category") {
            mainCategoryName = String(row[key] || "").trim();
          } else if (normalizedKey === "subcategory") {
            subCategoryName = String(row[key] || "").trim();
          }
        }

        if (!mainCategoryName) {
          skippedCount++;
          continue;
        }

        // Check if Main Category exists (case-insensitive exact match)
        let mainCategory = await this.categoryRepo.findOne({
          where: {
            name: { $regex: new RegExp(`^${mainCategoryName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
            type: CategoryType.MAIN,
            isDeleted: false
          }
        });

        if (!mainCategory) {
          mainCategory = new Category();
          mainCategory.name = mainCategoryName;
          mainCategory.type = CategoryType.MAIN;
          mainCategory.status = CategoryStatus.ACTIVE;
          mainCategory.isDeleted = false;
          mainCategory = await this.categoryRepo.save(mainCategory);
          createdMainCount++;
        }

        if (subCategoryName) {
          // Check if Sub Category exists under this Main Category (case-insensitive exact match)
          const subCategory = await this.categoryRepo.findOne({
            where: {
              name: { $regex: new RegExp(`^${subCategoryName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") },
              type: CategoryType.SUB,
              parentCategory: mainCategory._id,
              isDeleted: false
            }
          });

          if (!subCategory) {
            const newSub = new Category();
            newSub.name = subCategoryName;
            newSub.type = CategoryType.SUB;
            newSub.parentCategory = mainCategory._id;
            newSub.status = CategoryStatus.ACTIVE;
            newSub.isDeleted = false;
            await this.categoryRepo.save(newSub);
            createdSubCount++;
          } else {
            skippedCount++;
          }
        }
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Categories processed successfully.",
        data: {
          createdMainCategories: createdMainCount,
          createdSubCategories: createdSubCount,
          skippedRows: skippedCount
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories:
   *   get:
   *     summary: Get all categories with pagination and search
   *     tags: [Category]
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
   *         name: type
   *         schema: { type: string, enum: [MAIN, SUB, REFERRAL] }
   *     responses:
   *       200:
   *         description: List of categories
   */
  @Get("/")
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("referralParent") referralParent: string,
    @QueryParam("parentCategory") parentCategory: string,
    @QueryParam("type") type: string,
    @QueryParam("status") status: string,
    @Res() res: any,
    @Req() req: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      let allowed = isSuperAdmin;
      if (!allowed) {
        if (requiredModule !== "categories") {
          allowed = await hasPermission(role, requiredModule, "view");
        } else {
          allowed = (await hasPermission(role, "categories", "view")) ||
            (await hasPermission(role, "main_categories", "view")) ||
            (await hasPermission(role, "sub_categories", "view")) ||
            (await hasPermission(role, "referral_categories", "view"));
        }
      }

      if (!allowed) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }
      const where: any = { isDeleted: false };
      if (search) {
        if (type === CategoryType.SUB) {
          const matchingMainCategories = await this.categoryRepo.find({
            where: {
              name: { $regex: search, $options: "i" },
              type: CategoryType.MAIN,
              isDeleted: false
            }
          });
          const matchingMainIds = matchingMainCategories.map(m => m._id);
          where.$or = [
            { name: { $regex: search, $options: "i" } },
            { parentCategory: { $in: matchingMainIds } }
          ];
        } else {
          where.name = { $regex: search, $options: "i" };
        }
      }
      if (status) {
        where.status = status;
      }
      if (parentCategory && ObjectId.isValid(parentCategory)) {
        where.parentCategory = new ObjectId(parentCategory);
      }
      if (type) {
        if (type === CategoryType.REFERRAL) {
          where.type = CategoryType.SUB;
          where.referralParent = null;
        } else {
          where.type = type;
        }
      }

      if (referralParent) {
        where.referralParent = { $exists: referralParent === "true" };
        where.type = CategoryType.SUB;
      }

      const [categories, total] = await this.categoryRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
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
        { $match: { parentCategory: { $in: categoryIds }, isDeleted: false } },
        { $group: { _id: "$parentCategory", count: { $sum: 1 } } }
      ]).toArray();

      const referralCounts = await this.categoryRepo.aggregate([
        { $match: { referralParent: { $in: categoryIds }, isDeleted: false } },
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
   * /api/admin/categories/{id}:
   *   get:
   *     summary: Get a single category by ID
   *     tags: [Category]
   */
  @Get("/:id")
  async getOne(@Param("id") id: string, @Res() res: any, @Req() req: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!category) throw new NotFoundError("Category not found");

      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (category.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (category.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (category.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "view"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      // Populate parents
      const populated: any = { ...category };
      if (category.parentCategory) {
        const parent = await this.categoryRepo.findOneBy({ _id: category.parentCategory });
        populated.parentCategory = parent ? { _id: parent._id, name: parent.name } : null;
      }
      if (category.referralParent) {
        const ref = await this.categoryRepo.findOneBy({ _id: category.referralParent });
        populated.referralParent = ref ? { _id: ref._id, name: ref.name } : null;
      }

      // ✅ Add counts
      populated.subCategoryCount = await this.categoryRepo.count({
        where: { parentCategory: category._id, isDeleted: false }
      });
      populated.referralCount = await this.categoryRepo.count({
        where: { referralParent: category._id, isDeleted: false }
      });

      return res.status(StatusCodes.OK).json(populated);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories/{id}:
   *   put:
   *     summary: Update a category
   *     tags: [Category]
   */
  @Put("/:id")
  async update(@Param("id") id: string, @Body() data: UpdateCategoryDto, @Res() res: any, @Req() req: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Category not found");

      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (category.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (category.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (category.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      let allowed = isSuperAdmin;
      if (!allowed) {
        allowed = await hasPermission(role, requiredModule, "edit");
        if (!allowed && category.referralParent) {
          allowed = await hasPermission(role, "referral_categories", "edit");
        }
      }

      if (!allowed) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      if (data.status === CategoryStatus.INACTIVE && category.status !== CategoryStatus.INACTIVE) {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        const mappedMember = await memberRepo.findOne({
          where: {
            $or: [
              { businessCategory: category._id },
              { subCategory: category._id }
            ],
            isDeleted: false
          }
        });
        if (mappedMember) {
          throw new BadRequestError("Category cannot be deactivated as it is mapped to active members");
        }

        if (category.type === CategoryType.MAIN) {
          const subCategoryExists = await this.categoryRepo.findOne({
            where: {
              parentCategory: category._id,
              isDeleted: false
            }
          });
          if (subCategoryExists) {
            throw new BadRequestError("Category cannot be deactivated as it has associated subcategories");
          }
        }
      }

      if (data.name) category.name = data.name;
      if (data.status) category.status = data.status;
      if (data.parentCategory) category.parentCategory = new ObjectId(data.parentCategory);
      if (data.referralParent) category.referralParent = new ObjectId(data.referralParent);

      const saved = await this.categoryRepo.save(category);
      return res.status(StatusCodes.OK).json(saved);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/categories/{id}:
   *   delete:
   *     summary: Delete a category (Soft Delete)
   *     tags: [Category]
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any, @Req() req: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID");

      const category = await this.categoryRepo.findOneBy({ _id: new ObjectId(id), isDeleted: false });
      if (!category) throw new NotFoundError("Category not found");

      const role = req.user?.role;
      const isSuperAdmin = role?.name === "Super Admin";
      let requiredModule = "categories";
      if (category.type === CategoryType.MAIN) {
        requiredModule = "main_categories";
      } else if (category.type === CategoryType.SUB) {
        requiredModule = "sub_categories";
      } else if (category.type === CategoryType.REFERRAL) {
        requiredModule = "referral_categories";
      }

      if (!isSuperAdmin && !(await hasPermission(role, requiredModule, "delete"))) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          message: "Permission denied: Insufficient permissions"
        });
      }

      const memberRepo = AppDataSource.getMongoRepository(Member);
      const mappedMember = await memberRepo.findOne({
        where: {
          $or: [
            { businessCategory: category._id },
            { subCategory: category._id }
          ],
          isDeleted: false
        }
      });
      if (mappedMember) {
        throw new BadRequestError("Category cannot be deleted as it is mapped to active members");
      }

      if (category.type === CategoryType.MAIN) {
        const subCategoryExists = await this.categoryRepo.findOne({
          where: {
            parentCategory: category._id,
            isDeleted: false
          }
        });
        if (subCategoryExists) {
          throw new BadRequestError("Category cannot be deleted as it has associated subcategories");
        }
      }

      await this.categoryRepo.update(new ObjectId(id), { isDeleted: true });

      return res.status(StatusCodes.OK).json({ message: "Category deleted successfully" });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
