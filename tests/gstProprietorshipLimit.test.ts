import {
  isProprietorship,
  getGstMaxAllowedMembers,
  getGstMaxLimitErrorMessage
} from "../src/utils/gst.helper";

describe("GST Proprietorship Registration Limit Utilities and Rules", () => {
  describe("isProprietorship", () => {
    it("should return true for various forms of Proprietorship", () => {
      expect(isProprietorship("Proprietorship")).toBe(true);
      expect(isProprietorship("proprietorship")).toBe(true);
      expect(isProprietorship("PROPRIETORSHIP")).toBe(true);
      expect(isProprietorship(" Proprietorship ")).toBe(true);
      expect(isProprietorship("Proprietor")).toBe(true);
      expect(isProprietorship("proprietor")).toBe(true);
      expect(isProprietorship("Sole Proprietorship")).toBe(true);
      expect(isProprietorship("sole proprietorship")).toBe(true);
    });

    it("should return false for non-proprietorship business types", () => {
      expect(isProprietorship("Partnership")).toBe(false);
      expect(isProprietorship("Private Limited Company")).toBe(false);
      expect(isProprietorship("Public Limited Company")).toBe(false);
      expect(isProprietorship("Limited Liability Partnership")).toBe(false);
      expect(isProprietorship("Society/ Club/ Trust/ AOP")).toBe(false);
      expect(isProprietorship("Hindu Undivided Family")).toBe(false);
    });

    it("should return false for empty, null, undefined or invalid input", () => {
      expect(isProprietorship(null)).toBe(false);
      expect(isProprietorship(undefined)).toBe(false);
      expect(isProprietorship("")).toBe(false);
      expect(isProprietorship("   ")).toBe(false);
    });
  });

  describe("getGstMaxAllowedMembers", () => {
    it("should return 1 for Proprietorship", () => {
      expect(getGstMaxAllowedMembers(true)).toBe(1);
    });

    it("should return 2 for non-proprietorship", () => {
      expect(getGstMaxAllowedMembers(false)).toBe(2);
    });
  });

  describe("getGstMaxLimitErrorMessage", () => {
    it("should return appropriate message for 1 member limit (Proprietorship)", () => {
      expect(getGstMaxLimitErrorMessage(1)).toBe(
        "GST number is already registered with maximum allowed members (1 for Proprietorship)"
      );
    });

    it("should return appropriate message for 2 member limit", () => {
      expect(getGstMaxLimitErrorMessage(2)).toBe(
        "GST number is already registered with maximum allowed members (2)"
      );
    });
  });

  describe("GST Verification and Registration Limit Decision Logic", () => {
    const checkCanRegister = (
      gstDataCtb: string | undefined,
      existingMembers: Array<{ businessType?: string }>
    ) => {
      const isProprietor =
        isProprietorship(gstDataCtb) ||
        existingMembers.some(m => isProprietorship(m.businessType));
      const maxAllowed = getGstMaxAllowedMembers(isProprietor);

      if (existingMembers.length >= maxAllowed) {
        return {
          allowed: false,
          maxAllowed,
          error: getGstMaxLimitErrorMessage(maxAllowed)
        };
      }
      return { allowed: true, maxAllowed };
    };

    it("should allow first member when gstData.ctb is 'Proprietorship'", () => {
      const result = checkCanRegister("Proprietorship", []);
      expect(result.allowed).toBe(true);
      expect(result.maxAllowed).toBe(1);
    });

    it("should block second member when gstData.ctb is 'Proprietorship' and 1 member already registered", () => {
      const result = checkCanRegister("Proprietorship", [{ businessType: "Proprietorship" }]);
      expect(result.allowed).toBe(false);
      expect(result.maxAllowed).toBe(1);
      expect(result.error).toBe(
        "GST number is already registered with maximum allowed members (1 for Proprietorship)"
      );
    });

    it("should allow up to 2 members when gstData.ctb is 'Partnership'", () => {
      // 0 members -> allowed
      const result0 = checkCanRegister("Partnership", []);
      expect(result0.allowed).toBe(true);
      expect(result0.maxAllowed).toBe(2);

      // 1 member -> allowed
      const result1 = checkCanRegister("Partnership", [{ businessType: "Partnership" }]);
      expect(result1.allowed).toBe(true);
      expect(result1.maxAllowed).toBe(2);

      // 2 members -> blocked
      const result2 = checkCanRegister("Partnership", [
        { businessType: "Partnership" },
        { businessType: "Partnership" }
      ]);
      expect(result2.allowed).toBe(false);
      expect(result2.maxAllowed).toBe(2);
      expect(result2.error).toBe(
        "GST number is already registered with maximum allowed members (2)"
      );
    });
  });
});
