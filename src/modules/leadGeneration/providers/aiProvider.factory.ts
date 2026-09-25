import { IAIProvider } from "./aiProvider.interface";
import { OpenAIProvider } from "./openai.provider";
import { GeminiProvider } from "./gemini.provider";

export class AIProviderFactory {
  static getProvider(providerName?: string): IAIProvider {
    const selectedProvider = (
      providerName ||
      process.env.AI_PROVIDER ||
      (process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY ? "gemini" : "openai")
    ).toLowerCase();

    switch (selectedProvider) {
    case "gemini":
    case "google":
      return new GeminiProvider();
    case "openai":
    default:
      return new OpenAIProvider();
    }
  }
}
