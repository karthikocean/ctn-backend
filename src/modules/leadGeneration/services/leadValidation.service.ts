import {
  CreateLeadGenerationInputSchema,
  UpdatePromptInputSchema,
  AILeadsResponseSchema,
  CreateLeadGenerationInput,
  UpdatePromptInput,
  AILeadItem
} from "../schemas/leadGeneration.schema";

export class LeadValidationService {
  static validateCreateInput(data: unknown): CreateLeadGenerationInput {
    return CreateLeadGenerationInputSchema.parse(data);
  }

  static validatePromptUpdate(data: unknown): UpdatePromptInput {
    return UpdatePromptInputSchema.parse(data);
  }

  static validateAILeads(data: unknown): AILeadItem[] {
    return AILeadsResponseSchema.parse(data);
  }
}
