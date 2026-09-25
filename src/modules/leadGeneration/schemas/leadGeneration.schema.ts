import { z } from "zod";

export const CreateLeadGenerationInputSchema = z.object({
  businessNames: z
    .union([
      z.array(z.string().trim().min(1, "Business name cannot be empty")).min(1, "At least one business name/sector is required").max(10, "Maximum 10 business names allowed"),
      z.string().trim().min(1, "Business name cannot be empty").transform((val) => val.split(",").map((s) => s.trim()).filter(Boolean))
    ])
    .refine((val) => Array.isArray(val) && val.length > 0, "At least one business name/sector is required"),
  locations: z
    .union([
      z.array(z.string().trim().min(1, "Location cannot be empty")).min(1, "At least one location is required").max(10, "Maximum 10 locations allowed"),
      z.string().trim().min(1, "Location cannot be empty").transform((val) => val.split(",").map((s) => s.trim()).filter(Boolean))
    ])
    .refine((val) => Array.isArray(val) && val.length > 0, "At least one location is required"),
  additionalRequirement: z
    .string()
    .trim()
    .max(1000, "Additional requirement cannot exceed 1000 characters")
    .optional()
    .nullable()
    .transform((val) => (val && val.length > 0 ? val : undefined))
});

export const UpdatePromptInputSchema = z.object({
  prompt: z.string().trim().min(10, "Prompt must be at least 10 characters").max(5000, "Prompt cannot exceed 5000 characters")
});

export const AILeadItemSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  category: z.string().trim().optional(),
  locations: z.array(z.string().trim()).optional().default([]),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  website: z.string().trim().optional(),
  description: z.string().trim().optional(),
  confidenceScore: z.number().min(0).max(100).optional()
});

export const AILeadsResponseSchema = z.union([
  z.array(AILeadItemSchema),
  z.object({
    leads: z.array(AILeadItemSchema)
  }).transform((val) => val.leads)
]);

export type CreateLeadGenerationInput = z.infer<typeof CreateLeadGenerationInputSchema>;
export type UpdatePromptInput = z.infer<typeof UpdatePromptInputSchema>;
export type AILeadItem = z.infer<typeof AILeadItemSchema>;
