import {
  CreateLeadGenerationInputSchema,
  UpdatePromptInputSchema,
  AILeadsResponseSchema
} from "../src/modules/leadGeneration/schemas/leadGeneration.schema";
import { PromptBuilderService } from "../src/modules/leadGeneration/services/promptBuilder.service";
import { LeadNormalizationService } from "../src/modules/leadGeneration/services/leadNormalization.service";
import { LeadGenerationLimitService } from "../src/modules/leadGeneration/services/leadGenerationLimit.service";
import { AIProviderFactory } from "../src/modules/leadGeneration/providers/aiProvider.factory";
import { OpenAIProvider } from "../src/modules/leadGeneration/providers/openai.provider";
import { GeminiProvider } from "../src/modules/leadGeneration/providers/gemini.provider";

jest.mock("../src/modules/leadGeneration/queues/leadGeneration.queue", () => ({
  LEAD_GENERATION_QUEUE_NAME: "lead-generation",
  leadGenerationJobOptions: {},
  leadGenerationQueue: {
    add: jest.fn().mockResolvedValue({ id: "test-job-id" }),
    close: jest.fn().mockResolvedValue(undefined)
  },
  addLeadGenerationJob: jest.fn().mockResolvedValue("test-job-id")
}));

jest.mock("../src/modules/leadGeneration/workers/leadGeneration.worker", () => ({
  leadGenerationWorker: {
    close: jest.fn().mockResolvedValue(undefined)
  }
}));

describe("AI Lead Generation Module Unit & Integration Tests", () => {
  describe("1. Input Schema Validation (Zod)", () => {
    it("should accept valid input with arrays of businessNames and locations", () => {
      const input = {
        businessNames: ["Software Companies", "Cloud Providers"],
        locations: ["Bangalore", "San Francisco"],
        additionalRequirement: "Must have B2B SaaS focus"
      };

      const parsed = CreateLeadGenerationInputSchema.parse(input);
      expect(parsed.businessNames).toEqual(["Software Companies", "Cloud Providers"]);
      expect(parsed.locations).toEqual(["Bangalore", "San Francisco"]);
      expect(parsed.additionalRequirement).toBe("Must have B2B SaaS focus");
    });

    it("should transform comma-separated string inputs into arrays", () => {
      const input = {
        businessNames: "Fintech, EdTech, MedTech",
        locations: "Mumbai, Pune"
      };

      const parsed = CreateLeadGenerationInputSchema.parse(input);
      expect(parsed.businessNames).toEqual(["Fintech", "EdTech", "MedTech"]);
      expect(parsed.locations).toEqual(["Mumbai", "Pune"]);
      expect(parsed.additionalRequirement).toBeUndefined();
    });

    it("should reject empty businessNames or empty locations", () => {
      expect(() => {
        CreateLeadGenerationInputSchema.parse({
          businessNames: [],
          locations: ["Chennai"]
        });
      }).toThrow();

      expect(() => {
        CreateLeadGenerationInputSchema.parse({
          businessNames: ["Solar"],
          locations: []
        });
      }).toThrow();
    });

    it("should reject additionalRequirement exceeding 1000 characters", () => {
      const longRequirement = "A".repeat(1001);
      expect(() => {
        CreateLeadGenerationInputSchema.parse({
          businessNames: ["Solar"],
          locations: ["Chennai"],
          additionalRequirement: longRequirement
        });
      }).toThrow(/cannot exceed 1000 characters/);
    });

    it("should validate prompt update length constraints", () => {
      expect(() => {
        UpdatePromptInputSchema.parse({ prompt: "Short" });
      }).toThrow(/at least 10 characters/);

      const valid = UpdatePromptInputSchema.parse({
        prompt: "This is a detailed and updated prompt for AI lead generation."
      });
      expect(valid.prompt).toBe("This is a detailed and updated prompt for AI lead generation.");
    });
  });

  describe("2. Prompt Builder Service", () => {
    it("should format prompt with structured delimiters and instructions", () => {
      const result = PromptBuilderService.buildPrompt({
        businessNames: ["EV Charging Manufacturers", "Battery Suppliers"],
        locations: ["Delhi NCR", "Bangalore"],
        additionalRequirement: "Looking for ISO 9001 certified companies"
      });

      expect(result.version).toBe("1.0");
      expect(result.prompt).toContain("<business_names_or_sectors>");
      expect(result.prompt).toContain("- EV Charging Manufacturers");
      expect(result.prompt).toContain("- Battery Suppliers");
      expect(result.prompt).toContain("</business_names_or_sectors>");
      expect(result.prompt).toContain("<locations>");
      expect(result.prompt).toContain("- Delhi NCR");
      expect(result.prompt).toContain("</locations>");
      expect(result.prompt).toContain("<additional_requirement>");
      expect(result.prompt).toContain("Looking for ISO 9001 certified companies");
      expect(result.prompt).toContain("</additional_requirement>");
      expect(result.prompt).toContain("<instructions>");
      expect(result.prompt).toContain("Return your response ONLY as a JSON object with a \"leads\" array");
    });

    it("should omit <additional_requirement> when not provided", () => {
      const result = PromptBuilderService.buildPrompt({
        businessNames: ["Logistics"],
        locations: ["Chennai"]
      });

      expect(result.prompt).not.toContain("<additional_requirement>");
      expect(result.prompt).toContain("<business_names_or_sectors>");
      expect(result.prompt).toContain("<locations>");
    });
  });

  describe("3. AI Response Validation Schema", () => {
    it("should validate and extract leads from { leads: [...] } object", () => {
      const rawPayload = {
        leads: [
          {
            businessName: "EcoCharge Technologies",
            category: "EV Infrastructure",
            locations: ["Bangalore, India"],
            phone: "+91-9876543210",
            email: "contact@ecocharge.in",
            website: "https://www.ecocharge.in",
            description: "Manufactures high-speed DC chargers for commercial fleets.",
            confidenceScore: 92
          }
        ]
      };

      const validated = AILeadsResponseSchema.parse(rawPayload);
      expect(validated).toHaveLength(1);
      expect(validated[0].businessName).toBe("EcoCharge Technologies");
      expect(validated[0].confidenceScore).toBe(92);
    });

    it("should validate direct array of leads", () => {
      const rawPayload = [
        {
          businessName: "CleanVolt Systems",
          category: "Battery Storage",
          locations: ["Delhi"]
        }
      ];

      const validated = AILeadsResponseSchema.parse(rawPayload);
      expect(validated).toHaveLength(1);
      expect(validated[0].businessName).toBe("CleanVolt Systems");
    });

    it("should reject invalid lead item missing businessName", () => {
      const invalidPayload = {
        leads: [
          {
            category: "EV Infrastructure",
            locations: ["Bangalore"]
          }
        ]
      };

      expect(() => {
        AILeadsResponseSchema.parse(invalidPayload);
      }).toThrow();
    });
  });

  describe("4. Normalization and Deduplication Logic", () => {
    it("should normalize business names by removing company suffixes and punctuation", () => {
      expect(LeadNormalizationService.normalizeBusinessName("Acme Solutions, Inc.")).toBe(
        "acme solutions"
      );
      expect(LeadNormalizationService.normalizeBusinessName("  Global Tech Pvt. Ltd. ")).toBe(
        "global tech"
      );
      expect(LeadNormalizationService.normalizeBusinessName("Zenith Corp.")).toBe("zenith");
    });

    it("should normalize websites extracting standardized domains", () => {
      const res1 = LeadNormalizationService.normalizeWebsite("https://www.example.com/about/");
      expect(res1.normalizedKey).toBe("example.com");
      expect(res1.displayUrl).toBe("https://www.example.com/about/");

      const res2 = LeadNormalizationService.normalizeWebsite("http://subdomain.acme.co.in");
      expect(res2.normalizedKey).toBe("subdomain.acme.co.in");

      const res3 = LeadNormalizationService.normalizeWebsite("mycompany.org");
      expect(res3.normalizedKey).toBe("mycompany.org");
      expect(res3.displayUrl).toBe("https://mycompany.org");
    });

    it("should deduplicate leads with identical normalized business name", () => {
      const rawLeads = [
        {
          businessName: "Acme Corp",
          locations: ["New York"],
          website: "https://acme.com"
        },
        {
          businessName: "Acme, Inc.", // Same normalized name
          locations: ["San Francisco"],
          website: "https://acme-inc.com"
        },
        {
          businessName: "Beta Solutions",
          locations: ["Boston"],
          website: "https://beta.com"
        }
      ];

      const deduplicated = LeadNormalizationService.deduplicateLeads(rawLeads);
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated.map((d) => d.businessName)).toEqual(["Acme Corp", "Beta Solutions"]);
    });

    it("should deduplicate leads with identical website domain", () => {
      const rawLeads = [
        {
          businessName: "Solar Innovations",
          locations: ["Austin"],
          website: "https://www.solar-innovations.com"
        },
        {
          businessName: "Solar Innovations HQ",
          locations: ["Dallas"],
          website: "https://solar-innovations.com/contact" // Same normalized domain
        }
      ];

      const deduplicated = LeadNormalizationService.deduplicateLeads(rawLeads);
      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0].businessName).toBe("Solar Innovations");
    });
  });

  describe("5. Rate Limiting Service", () => {
    const testUser = "test-user-rate-limit-123";

    beforeEach(async () => {
      await LeadGenerationLimitService.reset(testUser);
    });

    afterEach(async () => {
      await LeadGenerationLimitService.reset(testUser);
    });

    it("should allow requests up to the configured limit and reject subsequent ones", async () => {
      process.env.LEAD_GENERATION_HOURLY_LIMIT = "3";

      const res1 = await LeadGenerationLimitService.checkAndIncrement(testUser);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);

      const res2 = await LeadGenerationLimitService.checkAndIncrement(testUser);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = await LeadGenerationLimitService.checkAndIncrement(testUser);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);

      const res4 = await LeadGenerationLimitService.checkAndIncrement(testUser);
      expect(res4.allowed).toBe(false);
      expect(res4.remaining).toBe(0);
    });
  });

  describe("6. AI Provider Factory", () => {
    it("should return OpenAI provider by default or when specified", () => {
      const provider = AIProviderFactory.getProvider("openai");
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.providerName).toBe("openai");
    });

    it("should return Gemini provider when specified", () => {
      const provider = AIProviderFactory.getProvider("gemini");
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.providerName).toBe("gemini");
    });
  });

  describe("7. LeadGenerationService Business Logic", () => {
    const { ObjectId } = require("mongodb");
    const { AppDataSource } = require("../src/data-source");
    const { LeadGenerationService } = require("../src/modules/leadGeneration/services/leadGeneration.service");
    const { LeadGenerationStatus } = require("../src/entity/LeadGenerationRequest");

    const mockRequestRepo = {
      save: jest.fn((entity) => {
        if (!entity._id) {
          entity._id = new ObjectId();
        }
        return Promise.resolve(entity);
      }),
      findOneBy: jest.fn(),
      find: jest.fn(),
      countBy: jest.fn()
    };

    const mockLeadRepo = {
      save: jest.fn((entities) => Promise.resolve(entities)),
      find: jest.fn(),
      countBy: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ acknowledged: true })
    };

    beforeAll(() => {
      jest.spyOn(AppDataSource, "getMongoRepository").mockImplementation((entity: any) => {
        if (entity.name === "LeadGenerationRequest") {
          return mockRequestRepo as any;
        }
        if (entity.name === "GeneratedLead") {
          return mockLeadRepo as any;
        }
        return {} as any;
      });
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      try {
        const { leadGenerationQueue } = require("../src/modules/leadGeneration/queues/leadGeneration.queue");
        const { leadGenerationWorker } = require("../src/modules/leadGeneration/workers/leadGeneration.worker");
        await Promise.allSettled([
          leadGenerationQueue?.close?.(),
          leadGenerationWorker?.close?.()
        ]);
      } catch {}
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should pre-store prompt and create request with PENDING status and version 1", async () => {
      const userId = "507f1f77bcf86cd799439011";
      const input = {
        businessNames: ["Fintech", "Payment Gateways"],
        locations: ["Singapore", "Tokyo"],
        additionalRequirement: "Series A or later"
      };

      const result = await LeadGenerationService.createLeadGeneration(userId, input);

      expect(mockRequestRepo.save).toHaveBeenCalledTimes(1);
      const savedEntity = mockRequestRepo.save.mock.calls[0][0];

      expect(savedEntity.userId).toBe(userId);
      expect(savedEntity.status).toBe(LeadGenerationStatus.PENDING);
      expect(savedEntity.version).toBe(1);
      expect(savedEntity.generatedPrompt).toContain("<business_names_or_sectors>");
      expect(savedEntity.generatedPrompt).toContain("- Fintech");
      expect(savedEntity.generatedPrompt).toContain("Series A or later");
      expect(result.status).toBe(LeadGenerationStatus.PENDING);
    });

    it("should enforce ownership and throw 403 if user does not own the generation request", async () => {
      const ownerId = "507f1f77bcf86cd799439011";
      const attackerId = "507f1f77bcf86cd799439099";
      const generationId = new ObjectId().toString();

      mockRequestRepo.findOneBy.mockResolvedValueOnce({
        _id: new ObjectId(generationId),
        userId: ownerId,
        isDeleted: false
      });

      await expect(
        LeadGenerationService.getLeadGenerationById(attackerId, generationId)
      ).rejects.toThrow(/Unauthorized/);
    });

    it("should regenerate creating a new document with incremented version and parent link", async () => {
      const userId = "507f1f77bcf86cd799439011";
      const parentOid = new ObjectId();
      const parentDoc = {
        _id: parentOid,
        userId,
        businessNames: ["Biotech"],
        locations: ["Boston"],
        additionalRequirement: undefined,
        generatedPrompt: "Original prompt...",
        promptVersion: "1.0",
        provider: "openai",
        model: "gpt-4o-mini",
        version: 1,
        status: LeadGenerationStatus.COMPLETED,
        isDeleted: false
      };

      mockRequestRepo.findOneBy.mockResolvedValueOnce(parentDoc);

      const regenerated = await LeadGenerationService.regenerate(
        userId,
        parentOid.toString(),
        "Updated prompt override for regeneration"
      );

      expect(mockRequestRepo.save).toHaveBeenCalledTimes(1);
      const savedNewDoc = mockRequestRepo.save.mock.calls[0][0];

      expect(savedNewDoc.version).toBe(2);
      expect(savedNewDoc.parentGenerationId).toBe(parentOid.toString());
      expect(savedNewDoc.generatedPrompt).toBe("Updated prompt override for regeneration");
      expect(savedNewDoc.status).toBe(LeadGenerationStatus.PENDING);
      // Ensure parent was NOT mutated or overwritten
      expect(parentDoc.version).toBe(1);
    });

    it("should soft delete generation request and mark associated leads as deleted", async () => {
      const userId = "507f1f77bcf86cd799439011";
      const genId = new ObjectId().toString();
      const existingDoc = {
        _id: new ObjectId(genId),
        userId,
        isDeleted: false
      };

      mockRequestRepo.findOneBy.mockResolvedValueOnce(existingDoc);

      const res = await LeadGenerationService.deleteLeadGeneration(userId, genId);

      expect(res.success).toBe(true);
      expect(existingDoc.isDeleted).toBe(true);
      expect(mockLeadRepo.updateMany).toHaveBeenCalledWith(
        { generationId: genId },
        expect.objectContaining({ $set: expect.objectContaining({ isDeleted: true }) })
      );
    });
  });
});
