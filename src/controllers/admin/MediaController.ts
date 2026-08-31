import { JsonController, Get, Post, Req, Res, BadRequestError, HttpCode, QueryParam } from "routing-controllers";
import imageService from "../../utils/upload";
import path from "path";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/media")
export class AdminMediaController {
  /**
   * @swagger
   * /api/admin/media/upload:
   *   post:
   *     summary: Upload multiple files (Images/Documents) - Admin
   *     tags: [Admin Media]
   *     parameters:
   *       - in: query
   *         name: folder
   *         schema:
   *           type: string
   *         description: The target folder for upload (e.g. banners, products, general)
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
      const maxSize = 50 * 1024 * 1024; // Admin can upload up to 50MB (for videos)
      const uploadedData = [];

      for (const file of files) {
        if (file.size > maxSize) {
          throw new BadRequestError(`File ${file.name} exceeds 50MB limit`);
        }

        const fileExt = path.extname(file.name);
        const fileName = `media-${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`;

        console.log(`Uploading file: ${fileName} to folder: ${targetFolder}`);
        const success = await imageService.fileUpload(file, targetFolder, fileName);
        console.log(`Upload success: ${success}`);

        if (success) {
          uploadedData.push({
            fileName: fileName,
            url: `/${targetFolder}/${fileName}`,
            size: file.size,
            mimetype: file.mimetype
          });
        }
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
   * /api/admin/media/view:
   *   get:
   *     summary: Get a full public S3 URL for a stored relative file path
   *     tags: [Admin Media]
   *     parameters:
   *       - in: query
   *         name: file
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path stored in DB (e.g. /posts/media-xxx.jpg)
   *     responses:
   *       200:
   *         description: Public S3 URL returned
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
        data: { file, url }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/media/private-view:
   *   get:
   *     summary: Generate a pre-signed S3 URL for a private file
   *     tags: [Admin Media]
   *     parameters:
   *       - in: query
   *         name: file
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path stored in DB (e.g. /trainings/media-xxx.mp4)
   *       - in: query
   *         name: expiresIn
   *         schema:
   *           type: integer
   *         description: Expiry in seconds (default 3600)
   *     responses:
   *       200:
   *         description: Pre-signed URL returned
   */
  @Get("/private-view")
  @HttpCode(StatusCodes.OK)
  async privateView(
    @QueryParam("file") file: string,
    @QueryParam("expiresIn") expiresIn: number,
    @Res() res: any
  ) {
    try {
      if (!file) {
        throw new BadRequestError("Query parameter 'file' is required.");
      }
      const ttl = expiresIn && expiresIn > 0 ? expiresIn : 3600;
      const url = await imageService.getPrivateFileUrl(file, ttl);
      return res.status(StatusCodes.OK).json({
        success: true,
        data: { file, url, expiresIn: ttl }
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /api/admin/media:
   *   get:
   *     summary: Get a list of uploaded media files in a specific folder
   *     tags: [Admin Media]
   *     parameters:
   *       - in: query
   *         name: folder
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: List of files retrieved successfully
   */
  @Get("/")
  @HttpCode(StatusCodes.OK)
  async getMedia(@QueryParam("folder") folder: string, @Res() res: any) {
    try {
      const fs = require("fs");
      const targetFolder = folder || "general";
      const folderPath = path.join(process.cwd(), "public", targetFolder);

      if (!fs.existsSync(folderPath)) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: []
        });
      }

      const files = fs.readdirSync(folderPath);
      const data = files.map((file: string) => ({
        fileName: file,
        url: `/${targetFolder}/${file}`
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        data: data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
