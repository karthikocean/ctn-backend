import { IsString, IsNotEmpty, IsEnum, IsOptional, IsArray } from "class-validator";
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
 *           enum: [MUTUAL-FRIEND, REGION]
 *           example: "REGION"
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
 *           enum: [MUTUAL-FRIEND, REGION]
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
}
