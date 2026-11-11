import { describe, expect, it } from "vitest";
import { selectPrimaryReviewIntent } from "../src/review/select-review-intent.js";

describe("selectPrimaryReviewIntent", () => {
  it("sélectionne le label enregistré de plus haute confiance", () => {
    expect(
      selectPrimaryReviewIntent([
        { name: "feature", confidence: 0.96, reason: "nouvelle API" },
        { name: "bug", confidence: 0.91, reason: "corrige un crash" },
      ]),
    ).toBe("feature");
  });

  it("ignore les labels sans expert enregistré", () => {
    expect(
      selectPrimaryReviewIntent([
        { name: "enhancement", confidence: 0.99, reason: "ajout" },
      ]),
    ).toBeNull();
  });
});
