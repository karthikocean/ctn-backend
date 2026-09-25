import axios from "axios";
import { IAIProvider, AIProviderConfig } from "./aiProvider.interface";
import { AIProviderResponse, RawLeadItem } from "../types/leadGeneration.types";
import { AILeadsResponseSchema } from "../schemas/leadGeneration.schema";
import { logger } from "../../../utils/logger";

export class GeminiProvider implements IAIProvider {
  readonly providerName = "gemini";
  readonly defaultModel = "gemini-2.5-flash-lite";
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config?: AIProviderConfig) {
    this.apiKey = config?.apiKey || process.env.GEMINI_API_KEY || "";
    this.baseUrl =
      config?.baseUrl ||
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
    this.timeoutMs = config?.timeoutMs || 45000;
  }

  async generateLeads(prompt: string, modelOverride?: string): Promise<AIProviderResponse> {
    if (!this.apiKey) {
      throw new Error("Gemini API key is missing. Please set GEMINI_API_KEY.");
    }
    console.log(process.env.GEMINI_MODEL, "sssssssssss");
    let model = (modelOverride || process.env.GEMINI_MODEL || this.defaultModel).trim();
    // Strip leading "models/" if configured like "models/gemini-2.5-flash-lite"
    model = model.replace(/^models\//, "");

    // Safety fallback: If an OpenAI model (e.g. gpt-4o-mini) was passed from legacy request, use default Gemini model
    if (/^(gpt-|o1-|o3-|text-)/i.test(model)) {
      model = (process.env.GEMINI_MODEL || this.defaultModel).replace(/^models\//, "").trim();
    }

    const startTime = Date.now();
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `${prompt}\n\nStrict output instruction: You must respond ONLY with a valid JSON object matching: {"leads": [{"businessName": string, "category"?: string, "locations": string[], "phone"?: string, "email"?: string, "website"?: string, "description"?: string, "confidenceScore"?: number}]}. Do not wrap with backticks or explanations.`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    try {
      const response = await axios.post(url, requestBody, {
        headers: { "Content-Type": "application/json" },
        timeout: this.timeoutMs
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = response.data;
      const content = rawResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";

      let jsonParsed: any;
      try {
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        jsonParsed = JSON.parse(cleaned);
      } catch (parseErr: any) {
        logger.error(`Gemini JSON parse failure: ${parseErr.message}. Content: ${content}`);
        throw new Error(`Failed to parse Gemini response as JSON: ${parseErr.message}`);
      }

      const validatedLeads = AILeadsResponseSchema.parse(jsonParsed) as RawLeadItem[];

      return {
        rawResponse,
        rawText: content,
        parsedLeads: validatedLeads,
        model,
        provider: this.providerName,
        usage: {
          promptTokens: rawResponse.usageMetadata?.promptTokenCount,
          completionTokens: rawResponse.usageMetadata?.candidatesTokenCount,
          totalTokens: rawResponse.usageMetadata?.totalTokenCount
        },
        latencyMs
      };
    } catch (err: any) {
      const apiErrorMessage =
        err.response?.data?.error?.message ||
        (err.response?.data ? JSON.stringify(err.response.data) : err.message);

      logger.error(`Gemini generation error: ${apiErrorMessage}`, {
        status: err.response?.status,
        data: err.response?.data,
        targetModel: model
      });

      const enrichedError = new Error(
        `Gemini API Error (status ${err.response?.status || "network"}): ${apiErrorMessage}`
      );
      (enrichedError as any).status = err.response?.status;
      throw enrichedError;
    }
  }
}
