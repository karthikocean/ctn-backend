import { IsString, IsNotEmpty, IsEnum, IsOptional, IsArray, IsMongoId } from "class-validator";
import { PostType, RequirementVisibility } from "../../entity/Post";

/**
 * @swagger
 * components:
 *   schemas:
 *     CreatePostDto:
 *       type: object
 *       required:
 *         - type
 *         - title
 *         - description
 *       properties:
 *         type:
 *           type: string
 *           enum: [PROMOTION, GIVE, ASK, REQUIREMENT]
 *           example: "REQUIREMENT"
 *         title:
 *           type: string
 *           example: "Need civil engineer"
 *         description:
 *           type: string
 *           example: "Looking for an engineer for a 15-day project in Chennai."
 *         location:
 *           type: string
 *           example: "Chennai"
 *         period:
 *           type: string
 *           example: "15 Days"
 *         media:
 *           type: array
 *           items:
 *             type: string
 *           example: ["/uploads/post1.jpg"]
 *         requirementVisibility:
 *           type: string
 *           enum: [MUTUAL-FRIEND, REGION, OVERALL]
 *           example: "REGION"
 *         stateIds:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a36616f64a1049a7f461acc"]
 *           description: Optional list of state ObjectIds (from /mobile-api/common/states)
 *         regionIds:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a0ec23d2d4c78a8d7cdfb6f"]
 *           description: Optional list of region area ObjectIds (from /mobile-api/common/business-regions)
 *         categoryIds:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a0ec23d2d4c78a8d7cdfb6a"]
 *           description: Optional list of category ObjectIds
 *         subCategoryIds:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a0ec23d2d4c78a8d7cdfb6b"]
 *           description: Optional list of sub-category ObjectIds
 *     UpdatePostDto:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum: [PROMOTION, GIVE, ASK, REQUIREMENT]
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         location:
 *           type: string
 *         period:
 *           type: string
 *         media:
 *           type: array
 *           items:
 *             type: string
 *         requirementVisibility:
 *           type: string
 *           enum: [MUTUAL-FRIEND, REGION, OVERALL]
 *         stateIds:
 *           type: array
 *           items:
 *             type: string
 *         regionIds:
 *           type: array
 *           items:
 *             type: string
 *         categoryIds:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a0ec23d2d4c78a8d7cdfb6a"]
 *           description: Optional list of category ObjectIds
 *         subCategoryIds:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6a0ec23d2d4c78a8d7cdfb6b"]
 *           description: Optional list of sub-category ObjectIds
 */

export class CreatePostDto {
  @IsEnum(PostType)
  @IsNotEmpty()
    type!: PostType;

  @IsString()
  @IsNotEmpty()
    title!: string;

  @IsString()
  @IsNotEmpty()
    description!: string;

  @IsString()
  @IsOptional()
    location?: string;

  @IsString()
  @IsOptional()
    period?: string;

  @IsArray()
  @IsOptional()
    media?: string[];

  @IsEnum(RequirementVisibility)
  @IsOptional()
    requirementVisibility?: RequirementVisibility;

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    stateIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    regionIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    categoryIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    subCategoryIds?: string[];
}

export class UpdatePostDto {
  @IsEnum(PostType)
  @IsOptional()
    type?: PostType;

  @IsString()
  @IsOptional()
    title?: string;

  @IsString()
  @IsOptional()
    description?: string;

  @IsString()
  @IsOptional()
    location?: string;

  @IsString()
  @IsOptional()
    period?: string;

  @IsArray()
  @IsOptional()
    media?: string[];

  @IsEnum(RequirementVisibility)
  @IsOptional()
    requirementVisibility?: RequirementVisibility;

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    stateIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    regionIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    categoryIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
    subCategoryIds?: string[];
}
