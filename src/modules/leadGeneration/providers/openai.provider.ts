import axios from "axios";
import { IAIProvider, AIProviderConfig } from "./aiProvider.interface";
import { AIProviderResponse, RawLeadItem } from "../types/leadGeneration.types";
import { AILeadsResponseSchema } from "../schemas/leadGeneration.schema";
import { logger } from "../../../utils/logger";

export class OpenAIProvider implements IAIProvider {
  readonly providerName = "openai";
  readonly defaultModel = "gpt-4o-mini";
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config?: AIProviderConfig) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = config?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    this.timeoutMs = config?.timeoutMs || 45000;
  }

  async generateLeads(prompt: string, modelOverride?: string): Promise<AIProviderResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is missing. Please set OPENAI_API_KEY.");
    }

    let model = (modelOverride || process.env.OPENAI_MODEL || this.defaultModel).trim();
    if (/^gemini-/i.test(model)) {
      model = (process.env.OPENAI_MODEL || this.defaultModel).trim();
    }

    const startTime = Date.now();

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert business intelligence and lead generation assistant. Your task is to output strictly structured, verified JSON matching the user's criteria. Output ONLY a valid JSON object with a 'leads' array containing the lead items. Do not include markdown code ticks or conversational filler."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    };

    try {
      const response = await axios.post(`${this.baseUrl}/chat/completions`, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        timeout: this.timeoutMs
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = response.data;
      const content = rawResponse.choices?.[0]?.message?.content || "";

      let jsonParsed: any;
      try {
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        jsonParsed = JSON.parse(cleaned);
      } catch (parseErr: any) {
        logger.error(`OpenAI JSON parse failure: ${parseErr.message}. Content: ${content}`);
        throw new Error(`Failed to parse AI response as JSON: ${parseErr.message}`);
      }

      const validatedLeads = AILeadsResponseSchema.parse(jsonParsed) as RawLeadItem[];

      return {
        rawResponse,
        rawText: content,
        parsedLeads: validatedLeads,
        model,
        provider: this.providerName,
        usage: {
          promptTokens: rawResponse.usage?.prompt_tokens,
          completionTokens: rawResponse.usage?.completion_tokens,
          totalTokens: rawResponse.usage?.total_tokens
        },
        latencyMs
      };
    } catch (err: any) {
      const apiErrorMessage =
        err.response?.data?.error?.message ||
        (err.response?.data ? JSON.stringify(err.response.data) : err.message);

      logger.error(`OpenAI generation error: ${apiErrorMessage}`, {
        status: err.response?.status,
        data: err.response?.data,
        targetModel: model
      });

      const enrichedError = new Error(
        `OpenAI API Error (status ${err.response?.status || "network"}): ${apiErrorMessage}`
      );
      (enrichedError as any).status = err.response?.status;
      throw enrichedError;
    }
  }
}
