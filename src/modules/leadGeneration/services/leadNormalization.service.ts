import { RawLeadItem, NormalizedLeadItem } from "../types/leadGeneration.types";

export class LeadNormalizationService {
  /**
   * Normalizes business name for deduplication comparison.
   * e.g., "Acme Solutions, Inc." -> "acme solutions"
   */
  static normalizeBusinessName(name: string): string {
    if (!name) return "";
    return name
      .toLowerCase()
      .trim()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "") // remove punctuation
      .replace(/\b(inc|incorporated|llc|corp|corporation|ltd|limited|pvt|co|company)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Normalizes website URL into a safe display URL and a stripped domain key for deduplication.
   * e.g., "https://www.example.com/about/" -> display: "https://www.example.com/about/", key: "example.com"
   */
  static normalizeWebsite(url?: string): { displayUrl?: string; normalizedKey?: string } {
    if (!url || typeof url !== "string") return {};
    const trimmed = url.trim();
    if (!trimmed) return {};

    let fullUrl = trimmed;
    if (!/^https?:\/\//i.test(fullUrl)) {
      fullUrl = `https://${fullUrl}`;
    }

    try {
      const parsed = new URL(fullUrl);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return {
        displayUrl: fullUrl,
        normalizedKey: host
      };
    } catch {
      const stripped = trimmed.toLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
      return {
        displayUrl: fullUrl,
        normalizedKey: stripped
      };
    }
  }

  /**
   * Cleans phone strings.
   */
  static normalizePhone(phone?: string): string | undefined {
    if (!phone || typeof phone !== "string") return undefined;
    const trimmed = phone.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Normalizes a single lead item.
   */
  static normalizeLead(raw: RawLeadItem): NormalizedLeadItem {
    const businessName = raw.businessName.trim();
    const normalizedBusinessName = this.normalizeBusinessName(businessName);
    const { displayUrl, normalizedKey } = this.normalizeWebsite(raw.website);
    const phone = this.normalizePhone(raw.phone);
    const email = raw.email?.trim() ? raw.email.trim().toLowerCase() : undefined;
    const category = raw.category?.trim() || undefined;
    const description = raw.description?.trim() || undefined;

    const locations = Array.isArray(raw.locations)
      ? Array.from(new Set(raw.locations.map((l) => l.trim()).filter(Boolean)))
      : [];

    return {
      businessName,
      normalizedBusinessName,
      category,
      locations,
      phone,
      email,
      website: displayUrl,
      normalizedWebsite: normalizedKey,
      description,
      confidenceScore: typeof raw.confidenceScore === "number" ? raw.confidenceScore : 80
    };
  }

  /**
   * Deduplicates a list of leads against itself and optionally existing keys.
   */
  static deduplicateLeads(
    leads: RawLeadItem[],
    existingKeys?: Set<string>
  ): NormalizedLeadItem[] {
    const seenNames = new Set<string>(existingKeys || []);
    const seenWebsites = new Set<string>();
    const deduplicated: NormalizedLeadItem[] = [];

    for (const raw of leads) {
      const normalized = this.normalizeLead(raw);
      if (!normalized.normalizedBusinessName) continue;

      // Check name match
      if (seenNames.has(normalized.normalizedBusinessName)) {
        continue;
      }

      // Check website match if website is present
      if (normalized.normalizedWebsite && seenWebsites.has(normalized.normalizedWebsite)) {
        continue;
      }

      seenNames.add(normalized.normalizedBusinessName);
      if (normalized.normalizedWebsite) {
        seenWebsites.add(normalized.normalizedWebsite);
      }

      deduplicated.push(normalized);
    }

    return deduplicated;
  }
}
