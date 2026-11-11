import { describe, expect, it } from "vitest";
import { getExpertPolicy } from "../src/review/expert-policies.js";

describe("expert policies", () => {
  it("enregistre les experts feature et refactor", () => {
    expect(getExpertPolicy("feature")?.roleTitle).toContain("feature");
    expect(getExpertPolicy("refactor")?.reviewPolicy).toContain(
      "preserves observable behaviour",
    );
  });

  it("enregistre les experts documentation et tests", () => {
    expect(getExpertPolicy("documentation")?.classifiedAs).toContain(
      "documentation",
    );
    expect(getExpertPolicy("tests")?.reviewPolicy).toContain("assertions");
  });

  it("enregistre les experts ci-cd et dependencies", () => {
    expect(getExpertPolicy("ci-cd")?.roleTitle).toContain("CI/CD");
    expect(getExpertPolicy("dependencies")?.reviewPolicy).toContain("lockfile");
  });
});
