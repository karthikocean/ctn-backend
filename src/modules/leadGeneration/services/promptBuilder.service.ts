export class PromptBuilderService {
  static readonly PROMPT_VERSION = "1.0";

  /**
   * Builds an optimized structured prompt for AI lead generation.
   */
  static buildPrompt(params: {
    businessNames: string[];
    locations: string[];
    additionalRequirement?: string;
    leadCount?: number;
  }): { prompt: string; version: string } {
    const { businessNames, locations, additionalRequirement, leadCount = 5 } = params;

    const formattedBusinessNames = businessNames
      .map((name) => `- ${name.trim()}`)
      .join("\n");

    const formattedLocations = locations
      .map((loc) => `- ${loc.trim()}`)
      .join("\n");

    const requirementSection = additionalRequirement?.trim()
      ? `\n<additional_requirement>\n${additionalRequirement.trim()}\n</additional_requirement>`
      : "";

    const prompt = `You are an expert B2B business intelligence and market research specialist.
Your objective is to identify real, active, high-quality prospective business leads matching the given criteria.

<business_names_or_sectors>
${formattedBusinessNames}
</business_names_or_sectors>

<locations>
${formattedLocations}
</locations>${requirementSection}

<instructions>
1. Identify exactly ${leadCount} relevant business leads matching the specified sectors/names and target geographic locations.
2. If additional requirements are provided, ensure leads adhere strictly to those constraints (e.g. size, certifications, niche focus).
3. Provide accurate contact details wherever possible (official business name, primary location/city, phone number with country/area code, contact email, and active website domain).
4. Provide a brief 1-2 sentence description explaining why each lead is a relevant match.
5. Provide a confidenceScore between 0 and 100 reflecting the quality and relevance of the lead.
6. Return your response ONLY as a JSON object with a "leads" array containing exactly ${leadCount} objects in the following schema:
{
  "leads": [
    {
      "businessName": "Example Corp",
      "category": "Technology Consulting",
      "locations": ["City, State, Country"],
      "phone": "+1-555-0199",
      "email": "contact@example.com",
      "website": "https://www.example.com",
      "description": "Provides specialized enterprise consulting matching the requested criteria.",
      "confidenceScore": 95
    }
  ]
}
Do not include any conversational preamble, commentary, or markdown formatting outside of valid JSON.
</instructions>`;

    return {
      prompt,
      version: this.PROMPT_VERSION
    };
  }
}
