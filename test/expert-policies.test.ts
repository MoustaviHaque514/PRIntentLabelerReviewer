import { describe, expect, it } from "vitest";
import { getExpertPolicy } from "../src/review/expert-policies.js";

describe("expert policies", () => {
  it("enregistre les experts feature et refactor", () => {
    expect(getExpertPolicy("feature")?.roleTitle).toContain("feature");
    expect(getExpertPolicy("refactor")?.reviewPolicy).toContain(
      "preserves observable behaviour",
    );
  });
});
