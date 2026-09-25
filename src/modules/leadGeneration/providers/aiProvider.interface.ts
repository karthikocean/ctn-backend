import { AIProviderResponse } from "../types/leadGeneration.types";

export interface AIProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface IAIProvider {
  readonly providerName: string;
  readonly defaultModel: string;
  generateLeads(prompt: string, modelOverride?: string): Promise<AIProviderResponse>;
}
