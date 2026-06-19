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
  Res,
  UseBefore
} from "routing-controllers";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import { AppDataSource } from "../../data-source";
import { Role } from "../../entity/Role.Permission";
import { AdminUser } from "../../entity/AdminUser";
import { CreateRoleDto, UpdateRoleDto } from "../../dto/admin/Role.dto";
import { Module } from "../../entity/Module";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { emitToUsers } from "../../utils/socket";
import { canAccess } from "../../middlewares/PermissionMiddleware";

@JsonController("/roles")
export class RoleController {
  private roleRepo = AppDataSource.getMongoRepository(Role);
  private moduleRepo = AppDataSource.getMongoRepository(Module);

  /**
   * @swagger
   * /api/admin/roles:
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
  // @UseBefore(AuthMiddleware, canAccess("roles_permissions", "view"))
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
   * /api/admin/roles/modules:
   *   get:
   *     summary: List all available modules for permissions
   *     tags: [Role]
   *     responses:
   *       200:
   *         description: List of modules
   */
  @Get("/modules")
  @UseBefore(AuthMiddleware)
  async getModules(@Res() res: any) {
    try {
      const modules = await this.moduleRepo.find({ where: { isDelete: 0, isActive: 1 } });
      return res.status(StatusCodes.OK).json({ success: true, data: modules });
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/roles/{id}:
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
  // @UseBefore(AuthMiddleware, canAccess("roles_permissions", "view"))
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
   * /api/admin/roles:
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
  @UseBefore(AuthMiddleware, canAccess("roles_permissions", "create"))
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
        moduleId: ObjectId.isValid(p.moduleId) ? new ObjectId(p.moduleId) : p.moduleId,
        actions: p.actions
      })) as any;

      const savedRole = await this.roleRepo.save(newRole);
      return res.status(StatusCodes.CREATED).json(savedRole);
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/roles/{id}:
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
  @UseBefore(AuthMiddleware, canAccess("roles_permissions", "edit"))
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
          moduleId: ObjectId.isValid(p.moduleId) ? new ObjectId(p.moduleId) : p.moduleId,
          actions: p.actions
        })) as any;
      }

      const updatedRole = await this.roleRepo.save(role);

      // ✅ Notify users with this role about permission updates
      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const affectedUsers = await userRepo.find({
        where: { roleId: role._id, isDeleted: false }
      });

      const userIds = affectedUsers.map(u => u.id.toString());
      emitToUsers(userIds, "permissionsUpdated", {
        roleId: role._id.toString(),
        permissions: role.permissions
      });

      return res.status(StatusCodes.OK).json(updatedRole);
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/roles/{id}:
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
  @UseBefore(AuthMiddleware, canAccess("roles_permissions", "delete"))
  async delete(@Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid ID format");
      }

      const role = await this.roleRepo.findOne({
        where: { _id: new ObjectId(id), isDeleted: false }
      });

      if (!role) throw new NotFoundError("Role not found");

      // Check if any users are assigned to this role
      const userRepo = AppDataSource.getMongoRepository(AdminUser);
      const assignedUsersCount = await userRepo.count({
        roleId: new ObjectId(id),
        isDeleted: false
      });

      if (assignedUsersCount > 0) {
        throw new BadRequestError("Cannot delete role because it is currently assigned to one or more users.");
      }

      role.isDeleted = true;
      await this.roleRepo.save(role);

      return res.status(StatusCodes.OK).json({ message: "Role deleted successfully" });
    } catch (error) {
      return handleErrorResponse(error, res);
    }
  }
}
