import {
  JsonController,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  NotFoundError,
  BadRequestError,
  HttpCode,
  QueryParam,
  Res
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Role } from "../../entity/Role.Permission";
import { AdminUser } from "../../entity/AdminUser";
import { CreateRoleDto, UpdateRoleDto } from "../../dto/admin/Role.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/roles")
export class RoleController {
  private roleRepo = AppDataSource.getMongoRepository(Role);

  /**
   * @swagger
   * /api/roles:
   *   get:
   *     summary: List all roles with pagination
   *     tags: [Role]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 0
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Paginated list of roles
   */
  @Get("/")
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
        where.$or = [
          { name: { $regex: search, $options: "i" } },
          { code: { $regex: search, $options: "i" } }
        ];
      }

      const [roles, totalCount] = await this.roleRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit
      });

      const userRepo = AppDataSource.getMongoRepository(AdminUser);

      const rolesWithCounts = await Promise.all(roles.map(async (role) => {
        const userCount = await userRepo.count({
          roleId: role._id,
          isDeleted: false
        });

        return {
          ...role,
          userCount
        };
      }));

      return pagination(totalCount, rolesWithCounts, Number(limit), Number(page), res);
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/roles/{id}:
   *   get:
   *     summary: Get role by ID
   *     tags: [Role]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Role details
   *       404:
   *         description: Role not found
   */
  @Get("/:id")
  async getOne(@Param("id") id: string) {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid ID format");
    }
    const role = await this.roleRepo.findOne({
      where: { _id: new ObjectId(id), isDeleted: false }
    });
    if (!role) throw new NotFoundError("Role not found");
    return role;
  }

  /**
   * @swagger
   * /api/roles:
   *   post:
   *     summary: Create a new role
   *     tags: [Role]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateRoleDto'
   *     responses:
   *       201:
   *         description: Role created
   *       400:
   *         description: Role name or code already exists
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async create(@Body() roleData: CreateRoleDto, @Res() res: any) {
    try {
      // Check if name or code already exists
      const existingRole = await this.roleRepo.findOne({
        where: {
          $or: [
            { name: roleData.name },
            { code: roleData.code }
          ],
          isDeleted: false
        }
      });

      if (existingRole) {
        throw new BadRequestError("Role name or code already exists");
      }

      const newRole = new Role();
      newRole.name = roleData.name;
      newRole.code = roleData.code;
      newRole.description = roleData.description;
      newRole.isActive = roleData.isActive !== undefined ? roleData.isActive : true;
      newRole.isDeleted = false;

      // Map permissions to use ObjectId for moduleId
      newRole.permissions = roleData.permissions.map(p => ({
        moduleId: new ObjectId(p.moduleId),
        actions: p.actions
      }));

      const savedRole = await this.roleRepo.save(newRole);
      return res.status(StatusCodes.CREATED).json(savedRole);
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/roles/{id}:
   *   patch:
   *     summary: Update an existing role
   *     tags: [Role]
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
   *             $ref: '#/components/schemas/UpdateRoleDto'
   *     responses:
   *       200:
   *         description: Role updated
   *       404:
   *         description: Role not found
   */
  @Patch("/:id")
  async update(@Param("id") id: string, @Body() roleData: UpdateRoleDto, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID format");
      }

      const role = await this.roleRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!role) throw new NotFoundError("Role not found");

      if (roleData.name) role.name = roleData.name;
      if (roleData.code) role.code = roleData.code;
      if (roleData.description) role.description = roleData.description;
      if (roleData.isActive !== undefined) role.isActive = roleData.isActive;

      if (roleData.permissions) {
        role.permissions = roleData.permissions.map(p => ({
          moduleId: new ObjectId(p.moduleId),
          actions: p.actions
        }));
      }

      const updatedRole = await this.roleRepo.save(role);
      return res.status(StatusCodes.OK).json(updatedRole);
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/roles/{id}:
   *   delete:
   *     summary: Delete a role (Soft delete)
   *     tags: [Role]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Role deleted
   *       404:
   *         description: Role not found
   */
  @Delete("/:id")
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID format");
      }

      const role = await this.roleRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!role) throw new NotFoundError("Role not found");

      role.isDeleted = true;
      await this.roleRepo.save(role);

      return res.status(StatusCodes.OK).json({ message: "Role deleted successfully" });
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }
}
