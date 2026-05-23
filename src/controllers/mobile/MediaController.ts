import { JsonController, Get, Post, Req, Res, BadRequestError, HttpCode, QueryParam } from "routing-controllers";
import imageService from "../../utils/upload";
import path from "path";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";

@JsonController("/media")
export class MediaController {
  /**
   * @swagger
   * /mobile-api/media/upload:
   *   post:
   *     summary: Upload multiple files (Images/Documents)
   *     tags: [Mobile Media]
   *     parameters:
   *       - in: query
   *         name: folder
   *         schema:
   *           type: string
   *         description: The target folder for upload
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
      const maxSize = 20 * 1024 * 1024; // 20MB
      const uploadedData = [];

      for (const file of files) {
        if (file.size > maxSize) {
          throw new BadRequestError(`File ${file.name} exceeds 20MB limit`);
        }

        const fileExt = path.extname(file.name);
        const fileName = `media-${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`;

        const success = await imageService.fileUpload(file, targetFolder, fileName);

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
   * /mobile-api/media:
   *   get:
   *     summary: Get a list of all uploaded media files
   *     tags: [Mobile Media]
   *     responses:
   *       200:
   *         description: List of files retrieved successfully
   */
  @Get("/")
  @HttpCode(StatusCodes.OK)
  async getMedia(@Res() res: any) {
    try {
      const fs = require("fs");
      const folderPath = path.join(process.cwd(), "public", "general");

      if (!fs.existsSync(folderPath)) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: []
        });
      }

      const files = fs.readdirSync(folderPath);
      const data = files.map((file: string) => ({
        fileName: file,
        url: `/general/${file}`
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
