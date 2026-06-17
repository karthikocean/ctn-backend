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
  UseBefore
} from "routing-controllers";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { canAccess } from "../../middlewares/PermissionMiddleware";
import { AppDataSource } from "../../data-source";
import { Coupon } from "../../entity/Coupon";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { CreateCouponDto, UpdateCouponDto } from "../../dto/admin/Coupon.dto";

@JsonController("/coupons")
@UseBefore(AuthMiddleware)
export class AdminCouponController {
  private couponRepo = AppDataSource.getMongoRepository(Coupon);

  @Post("/")
  @UseBefore(canAccess("coupons", "create"))
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() data: CreateCouponDto, @Res() res: any) {
    try {
      const trimmedCode = data.code.trim().toUpperCase();
      const existing = await this.couponRepo.findOne({
        where: {
          code: trimmedCode,
          isDeleted: false
        }
      });
      if (existing) throw new BadRequestError("A coupon with this code already exists");

      const coupon = new Coupon();
      Object.assign(coupon, {
        ...data,
        code: trimmedCode,
        isDeleted: false,
        usedCount: 0
      });

      const saved = await this.couponRepo.save(coupon);
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Coupon created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/")
  @UseBefore(canAccess("coupons", "view"))
  async getAll(
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @Res() res: any
  ) {
    page = Number(page) || 0;
    limit = Number(limit) || 10;

    try {
      const where: any = { isDeleted: false };
      if (search) {
        where.code = { $regex: search, $options: "i" };
      }

      const [coupons, total] = await this.couponRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, coupons, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Get("/:id")
  @UseBefore(canAccess("coupons", "view"))
  async getOne(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID format");

      const coupon = await this.couponRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!coupon) throw new NotFoundError("Coupon not found");

      return res.status(StatusCodes.OK).json({
        success: true,
        data: coupon
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Put("/:id")
  @UseBefore(canAccess("coupons", "edit"))
  async update(@Param("id") id: string, @Body() data: UpdateCouponDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID format");

      const coupon = await this.couponRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!coupon) throw new NotFoundError("Coupon not found");

      if (data.code && data.code.trim().toUpperCase() !== coupon.code) {
        const trimmedCode = data.code.trim().toUpperCase();
        const existing = await this.couponRepo.findOne({
          where: {
            code: trimmedCode,
            isDeleted: false,
            _id: { $ne: new ObjectId(id) }
          }
        });
        if (existing) throw new BadRequestError("A coupon with this code already exists");
      }

      const updateData = { ...data };
      if (data.code) {
        updateData.code = data.code.trim().toUpperCase();
      }

      Object.assign(coupon, updateData);
      const saved = await this.couponRepo.save(coupon);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Coupon updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  @Delete("/:id")
  @UseBefore(canAccess("coupons", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid ID format");

      const coupon = await this.couponRepo.findOneBy({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!coupon) throw new NotFoundError("Coupon not found");

      coupon.isDeleted = true;
      await this.couponRepo.save(coupon);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Coupon deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
