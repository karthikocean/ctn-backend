import axios from "axios";
import FormData from "form-data";
import imageService from "../utils/upload";

interface SendDocumentParams {
  to: string; // e.g. "919361570434"
  filename: string;
  caption?: string;
  pdfBuffer?: Buffer;
  pdfUrl?: string;
}

export class WhatsAppService {
  private static apiVersion = "v19.0";

  /**
   * Upload media buffer directly to WhatsApp Cloud Media API
   */
  private static async uploadMediaToWhatsApp(buffer: Buffer, filename: string, mimeType = "application/pdf"): Promise<string> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneId) {
      throw new Error("WhatsApp Cloud API credentials (WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID) are missing");
    }

    const form = new FormData();
    form.append("file", buffer, { filename, contentType: mimeType });
    form.append("type", mimeType);
    form.append("messaging_product", "whatsapp");

    const response = await axios.post(`https://graph.facebook.com/${this.apiVersion}/${phoneId}/media`, form, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
    });

    if (response.data && response.data.id) {
      return response.data.id;
    }
    throw new Error("Failed to upload media to WhatsApp Cloud API");
  }

  /**
   * Send PDF document via WhatsApp Cloud API
   */
  static async sendPdfDocument({ to, filename, caption, pdfBuffer, pdfUrl }: SendDocumentParams) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneId) {
      throw new Error("WhatsApp Cloud API credentials (WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID) are missing");
    }

    let documentPayload: any = {
      filename,
      caption: caption || "Please find your document attached."
    };

    if (pdfBuffer) {
      try {
        // Option A: Upload directly to WhatsApp Media API
        const mediaId = await this.uploadMediaToWhatsApp(pdfBuffer, filename, "application/pdf");
        documentPayload.id = mediaId;
      } catch (mediaUploadError: any) {
        console.warn("[WhatsAppService] Direct media upload failed, falling back to S3 URL upload:", mediaUploadError.message);
        
        // Option B: Upload to S3 and provide public link
        const s3Key = `documents/whatsapp-${Date.now()}-${filename}`;
        await imageService.uploadToS3(s3Key, pdfBuffer, "application/pdf");
        const s3Url = imageService.getFileUrl(s3Key);
        documentPayload.link = s3Url;
      }
    } else if (pdfUrl) {
      documentPayload.link = pdfUrl;
    } else {
      throw new Error("Either pdfBuffer or pdfUrl must be provided");
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${phoneId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/\D/g, ""),
      type: "document",
      document: documentPayload
    };

    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    return response.data;
  }
}
