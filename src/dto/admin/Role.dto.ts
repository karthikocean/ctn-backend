/**
 * @swagger
 * components:
 *   schemas:
 *     PermissionDto:
 *       type: object
 *       required:
 *         - moduleId
 *         - actions
 *       properties:
 *         moduleId:
 *           type: string
 *         actions:
 *           type: array
 *           items:
 *             type: string
 *     CreateRoleDto:
 *       type: object
 *       required:
 *         - name
 *         - code
 *         - permissions
 *       properties:
 *         name:
 *           type: string
 *         code:
 *           type: string
 *         description:
 *           type: string
 *         permissions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PermissionDto'
 *         isActive:
 *           type: boolean
 *     UpdateRoleDto:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         code:
 *           type: string
 *         description:
 *           type: string
 *         permissions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PermissionDto'
 *         isActive:
 *           type: boolean
 */
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsBoolean, IsMongoId } from "class-validator";
import { Type } from "class-transformer";

export class PermissionDto {
    @IsMongoId()
    @IsNotEmpty()
      moduleId!: string;

    @IsArray()
    @IsString({ each: true })
      actions!: string[];
}

export class CreateRoleDto {
    @IsString()
    @IsNotEmpty()
      name!: string;

    @IsString()
    @IsNotEmpty()
      code!: string;

    @IsString()
    @IsOptional()
      description?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PermissionDto)
      permissions!: PermissionDto[];

    @IsOptional()
    @IsBoolean()
      isActive?: boolean;
}

export class UpdateRoleDto {
    @IsOptional()
    @IsString()
      name?: string;

    @IsOptional()
    @IsString()
      code?: string;

    @IsOptional()
    @IsString()
      description?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PermissionDto)
      permissions?: PermissionDto[];

    @IsOptional()
    @IsBoolean()
      isActive?: boolean;
}
