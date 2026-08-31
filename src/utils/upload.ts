import path from "path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ObjectIdentifier
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "video/mp4",
  "video/webm",
  "video/quicktime"
];
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".mp4", ".webm", ".mov"];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
  }
});

const BUCKET = process.env.AWS_S3_BUCKET_NAME || "";
const BASE_URL = (process.env.AWS_S3_BASE_URL || "").replace(/\/$/, "");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a relative path (stored in MongoDB) to an S3 object key.
 * Handles both "/posts/file.jpg" and "posts/file.jpg".
 */
function toS3Key(relativePath: string): string {
  return relativePath.replace(/^\/+/, "");
}

/**
 * Convert a relative path to the full public S3 URL.
 * "/posts/file.jpg" → "https://bucket.s3.amazonaws.com/posts/file.jpg"
 */
function toS3Url(relativePath: string): string {
  return `${BASE_URL}/${toS3Key(relativePath)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageService
// ─────────────────────────────────────────────────────────────────────────────
class ImageService {

  /* ------------------------------------------------------------------
     HELPER — Low-level S3 upload
     ------------------------------------------------------------------ */
  /**
   * Upload a Buffer to S3.
   * @param key      S3 object key, e.g. "posts/media-xxx.jpg"
   * @param buffer   File data
   * @param mimeType Content-Type for the stored object
   * @returns Relative path suitable for MongoDB, e.g. "/posts/media-xxx.jpg"
   */
  async uploadToS3(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType
      })
    );
    // Always return the relative path (leading slash) for MongoDB storage
    return `/${key}`;
  }

  /**
   * Convert a stored relative path to a full S3 URL for API responses.
   * "/posts/media-xxx.jpg" → "https://bucket.s3.amazonaws.com/posts/media-xxx.jpg"
   */
  getFileUrl(relativePath: string): string {
    return toS3Url(relativePath);
  }

  /**
   * Generate a pre-signed URL for a private S3 object.
   * Works with both "/posts/file.jpg" and "posts/file.jpg".
   * @param filePath  Relative path as stored in MongoDB
   * @param expiresIn Expiry in seconds (default 3600 = 1 hour)
   * @returns Temporary signed URL containing AWS signature parameters
   */
  async getPrivateFileUrl(filePath: string, expiresIn = 3600): Promise<string> {
    const key = toS3Key(filePath); // strip leading slash
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    });
    return getSignedUrl(s3, command, { expiresIn });
  }

  /**
   * Delete a single object from S3 using its relative path.
   * Accepts both "/posts/file.jpg" and "posts/file.jpg".
   */
  async deleteFromS3(relativePath: string): Promise<boolean> {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: toS3Key(relativePath)
        })
      );
      return true;
    } catch (error) {
      console.error("deleteFromS3 error:", error);
      return false;
    }
  }

  /**
   * Delete multiple objects from S3 in a single API call.
   * Accepts an array of relative paths.
   */
  async deleteMultipleFromS3(relativePaths: string[]): Promise<boolean> {
    if (!relativePaths.length) return true;
    try {
      const objects: ObjectIdentifier[] = relativePaths.map((p) => ({
        Key: toS3Key(p)
      }));
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: objects, Quiet: true }
        })
      );
      return true;
    } catch (error) {
      console.error("deleteMultipleFromS3 error:", error);
      return false;
    }
  }

  /**
   * Automatically cleans up S3 files that were replaced during an entity update.
   * Compares the previous value(s) with the new value(s) and deletes any old files that are no longer in the new set.
   *
   * @param oldMedia Single string or array of strings of old file paths
   * @param newMedia Single string or array of strings of new file paths
   */
  async cleanupReplacedFiles(
    oldMedia?: any,
    newMedia?: any
  ): Promise<void> {
    try {
      const oldList = (Array.isArray(oldMedia) ? oldMedia : [oldMedia]).filter((f): f is string => typeof f === "string" && f.trim().length > 0);
      const newList = (Array.isArray(newMedia) ? newMedia : [newMedia]).filter((f): f is string => typeof f === "string" && f.trim().length > 0);

      const filesToDelete = oldList.filter((oldFile) => !newList.includes(oldFile));
      if (filesToDelete.length > 0) {
        await this.deleteMultipleFromS3(filesToDelete);
      }
    } catch (err: any) {
      console.warn("⚠️ [MediaCleanup] Failed to delete replaced S3 files:", err.message || err);
    }
  }

  /**
   * Deletes all S3 files associated with an entity when the entity is deleted.
   * @param media Single string or array of strings of file paths to remove
   */
  async cleanupFiles(media?: any): Promise<void> {
    try {
      const list = (Array.isArray(media) ? media : [media]).filter((f): f is string => typeof f === "string" && f.trim().length > 0);
      if (list.length > 0) {
        await this.deleteMultipleFromS3(list);
      }
    } catch (err: any) {
      console.warn("⚠️ [MediaCleanup] Failed to delete S3 files:", err.message || err);
    }
  }

  /* ------------------------------------------------------------------
     IMAGE UPLOAD (BASE64)
     Kept for backward-compat with callers that pass base64 strings.
     ------------------------------------------------------------------ */
  async imageUpload(
    base64: string,
    folder: string,
    fileName: string,
    oldFileName?: string
  ): Promise<boolean> {
    try {
      const base64Data = base64.replace(/^data:(.*);base64,/, "");
      const mimeMatch = base64.match(/^data:(.*);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
      const buffer = Buffer.from(base64Data, "base64");

      const key = `${folder}/${fileName}`;
      await this.uploadToS3(key, buffer, mimeType);

      // Delete old file if present
      if (oldFileName) {
        await this.deleteFromS3(`${folder}/${oldFileName}`);
      }

      return true;
    } catch (error) {
      console.error("imageUpload error:", error);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     FILE UPLOAD (multipart/form-data via express-fileupload)
     ------------------------------------------------------------------ */
  async fileUpload(
    file: any,
    folder: string,
    fileName: string,
    oldFileName?: string
  ): Promise<boolean> {
    try {
      if (!file || !file.data) return false;

      const key = `${folder}/${fileName}`;
      await this.uploadToS3(key, file.data as Buffer, file.mimetype);

      // Delete old file if present
      if (oldFileName) {
        await this.deleteFromS3(`${folder}/${oldFileName}`);
      }

      return true;
    } catch (error) {
      console.error("fileUpload error:", error);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     DELETE IMAGE
     Kept for backward-compat: accepts (folder, fileName) separately.
     ------------------------------------------------------------------ */
  async deleteImage(folder: string, fileName: string): Promise<boolean> {
    return this.deleteFromS3(`${folder}/${fileName}`);
  }

  /* ------------------------------------------------------------------
     BUFFER FILE UPLOAD
     ------------------------------------------------------------------ */
  async fileUploadForBufferData(
    fileBuffer: Buffer,
    folder: string,
    fileName: string,
    oldFileName?: string
  ): Promise<boolean> {
    try {
      const ext = path.extname(fileName).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime"
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";

      const key = `${folder}/${fileName}`;
      await this.uploadToS3(key, fileBuffer, mimeType);

      if (oldFileName) {
        await this.deleteFromS3(`${folder}/${oldFileName}`);
      }

      return true;
    } catch (error) {
      console.error("fileUploadForBufferData error:", error);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     VALIDATE IMAGE FILE
     ------------------------------------------------------------------ */
  async validateImageFile(file: any): Promise<string> {
    if (!file) {
      throw new Error("File not found");
    }

    const extension = path.extname(file.name).toLowerCase();
    const mimeType = file.mimetype;

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new Error("Invalid file extension. Allowed: png, jpg, jpeg, mp4, webm, mov");
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new Error("Invalid file type. Only images and videos allowed");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error("File size exceeds 50MB limit");
    }

    return extension;
  }
}

const imageService = new ImageService();
export default imageService;
