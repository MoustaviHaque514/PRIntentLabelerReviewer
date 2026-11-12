import { describe, expect, it } from "vitest";
import {
  assertExpertIntention,
  assertExpertProvider,
  EXPERT_DEFINITIONS,
  EXPERT_PROVIDER_NAMES,
  isExpertIntention,
  isExpertProviderName,
} from "../src/configuration/expert-definitions.js";

describe("définitions des experts", () => {
  it("active uniquement bug et les trois fournisseurs prévus", () => {
    expect(Object.keys(EXPERT_DEFINITIONS)).toEqual(["bug"]);
    expect(EXPERT_PROVIDER_NAMES).toEqual(["anthropic", "openai", "gemini"]);
    expect(isExpertIntention("bug")).toBe(true);
    for (const provider of EXPERT_PROVIDER_NAMES) {
      expect(isExpertProviderName(provider)).toBe(true);
      expect(() => assertExpertProvider("bug", provider)).not.toThrow();
    }
  });

  it.each(["refactor", "documentation", "BUG", "__proto__", "toString", null])(
    "refuse l'intention non active %s",
    (value) => {
      expect(isExpertIntention(value)).toBe(false);
      expect(() => assertExpertIntention(value)).toThrow("pas configurable");
    },
  );

  it.each(["groq", "custom", "xai", "perplexity", "google", undefined])(
    "refuse le fournisseur %s",
    (value) => {
      expect(isExpertProviderName(value)).toBe(false);
      expect(() => assertExpertProvider("bug", value)).toThrow("pas autorisé");
    },
  );
});
