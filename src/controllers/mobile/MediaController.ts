import {
  JsonController,
  Get,
  Post,
  Delete,
  Req,
  Res,
  BadRequestError,
  HttpCode,
  QueryParam
} from "routing-controllers";
import path from "path";
import { StatusCodes } from "http-status-codes";
import imageService from "../../utils/upload";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/media")
export class MediaController {

  /**
   * @swagger
   * /mobile-api/media/upload:
   *   post:
   *     summary: Upload multiple files (Images/Videos) to S3
   *     tags: [Mobile Media]
   *     parameters:
   *       - in: query
   *         name: folder
   *         schema:
   *           type: string
   *         description: "The target S3 folder (default: general)"
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *     responses:
   *       200:
   *         description: Files uploaded successfully
   */
  @Post("/upload")
  @HttpCode(StatusCodes.OK)
  async upload(@QueryParam("folder") folder: string, @Req() req: any, @Res() res: any) {
    try {
      if (!req.files || !req.files.files) {
        throw new BadRequestError("No files uploaded. Please use 'files' field.");
      }

      const targetFolder = folder || "general";
      const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];
      const maxSize = 20 * 1024 * 1024; // 20 MB
      const uploadedData = [];

      for (const file of files) {
        if (file.size > maxSize) {
          throw new BadRequestError(`File ${file.name} exceeds 20MB limit`);
        }

        const fileExt = path.extname(file.name);
        const fileName = `media-${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`;
        const s3Key = `${targetFolder}/${fileName}`;

        // Upload to S3 using the service
        await imageService.uploadToS3(s3Key, file.data as Buffer, file.mimetype);

        // Store ONLY the relative path in MongoDB — never the full S3 URL
        const relativePath = `/${s3Key}`;

        uploadedData.push({
          fileName: fileName,
          url: relativePath,
          size: file.size,
          mimetype: file.mimetype
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `${uploadedData.length} files uploaded successfully`,
        data: uploadedData
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/media/view:
   *   get:
   *     summary: Get a full public S3 URL for a stored relative path
   *     tags: [Mobile Media]
   *     parameters:
   *       - in: query
   *         name: file
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path as stored in MongoDB (e.g. /posts/media-xxx.jpg)
   *     responses:
   *       200:
   *         description: Full S3 URL returned
   */
  @Get("/view")
  @HttpCode(StatusCodes.OK)
  async viewMedia(@QueryParam("file") file: string, @Res() res: any) {
    try {
      if (!file) {
        throw new BadRequestError("Query parameter 'file' is required.");
      }

      const url = imageService.getFileUrl(file);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: { url }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/media/private-view:
   *   get:
   *     summary: Generate a temporary pre-signed S3 URL for a private file
   *     tags: [Mobile Media]
   *     parameters:
   *       - in: query
   *         name: file
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path stored in MongoDB (e.g. /trainings/media-xxx.mp4)
   *     responses:
   *       200:
   *         description: Pre-signed URL returned
   */
  @Get("/private-view")
  @HttpCode(StatusCodes.OK)
  async privateView(@QueryParam("file") file: string, @Res() res: any) {
    try {
      if (!file) {
        throw new BadRequestError("File path is required.");
      }

      const url = await imageService.getPrivateFileUrl(file, 3600);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          file,
          url,
          expiresIn: 3600
        }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/media:
   *   get:
   *     summary: Legacy list endpoint — returns empty list (local filesystem removed)
   *     tags: [Mobile Media]
   *     responses:
   *       200:
   *         description: Empty list (files now stored in S3)
   */
  @Get("/")
  @HttpCode(StatusCodes.OK)
  async getMedia(@Res() res: any) {
    // Local filesystem listing is no longer available — all files live in S3.
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Files are now stored in AWS S3. Use GET /media/view?file=<relativePath> to get the full URL.",
      data: []
    });
  }

  /**
   * @swagger
   * /mobile-api/media:
   *   delete:
   *     summary: Delete a file from S3 by relative path
   *     tags: [Mobile Media]
   *     parameters:
   *       - in: query
   *         name: file
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path as stored in MongoDB (e.g. /posts/media-xxx.jpg)
   *     responses:
   *       200:
   *         description: File deleted successfully
   */
  @Delete("/")
  @HttpCode(StatusCodes.OK)
  async deleteMedia(@QueryParam("file") file: string, @Res() res: any) {
    try {
      if (!file) {
        throw new BadRequestError("Query parameter 'file' is required.");
      }

      const success = await imageService.deleteFromS3(file);

      if (!success) {
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to delete file from S3."
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "File deleted successfully."
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
