
export interface CreateLeadGenerationDTO {
  businessNames: string[];
  locations: string[];
  additionalRequirement?: string;
}

export interface UpdatePromptDTO {
  prompt: string;
}

export interface RawLeadItem {
  businessName: string;
  category?: string;
  locations?: string[];
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
  confidenceScore?: number;
}

export interface AIProviderResponse {
  rawResponse: any;
  rawText: string;
  parsedLeads: RawLeadItem[];
  model: string;
  provider: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs?: number;
}

export interface NormalizedLeadItem {
  businessName: string;
  normalizedBusinessName: string;
  category?: string;
  locations: string[];
  phone?: string;
  email?: string;
  website?: string;
  normalizedWebsite?: string;
  description?: string;
  confidenceScore?: number;
}

export interface LeadGenerationJobData {
  generationId: string;
  userId: string;
  promptOverride?: string;
}
