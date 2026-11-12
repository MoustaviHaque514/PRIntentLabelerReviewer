import { describe, expect, it } from "vitest";
import { calculatePayableTotal as fixedTotal } from "../demo/intent-reviews/bug/correct/cart-total.js";
import { quoteDiscount } from "../demo/intent-reviews/feature/correct/discount-endpoint.js";
import { calculatePayableTotal as refactoredTotal } from "../demo/intent-reviews/refactor/correct/pricing.js";
import { containsRepeatedValue } from "../demo/intent-reviews/performance/correct/lookup.js";
import { isTrustedToken } from "../demo/intent-reviews/security/correct/token.js";
import { calculatePayableTotal } from "../demo/intent-reviews/breaking-change/correct/public-api.js";
import { readFileSync } from "node:fs";

const demoRoot = new URL("../demo/intent-reviews/", import.meta.url);

function readDemo(path: string): string {
  return readFileSync(new URL(path, demoRoot), "utf8");
}

describe("démos correctes des experts", () => {
  it("valide les changements exécutables", () => {
    expect(fixedTotal(500, 800)).toBe(0);
    expect(quoteDiscount({ code: "SAVE10", subtotalCents: 1_000 })).toBe(100);
    expect(() => quoteDiscount({ code: "SAVE10", subtotalCents: -1 })).toThrow(
      RangeError,
    );
    expect(refactoredTotal(500, 800)).toBe(0);
    expect(containsRepeatedValue(["a", "b", "a"], "a")).toBe(true);
    expect(isTrustedToken("a".repeat(32))).toBe(true);
    expect(isTrustedToken("bypass")).toBe(false);
    expect(calculatePayableTotal(250)).toBe(250);
  });

  it("valide la documentation, les tests, CI et dépendances", () => {
    expect(readDemo("documentation/correct/CART.md")).toContain("// 0");
    expect(readDemo("tests/correct/cart-total.test.ts")).toContain(".toBe(0)");
    expect(readDemo("ci-cd/correct/ci.yml")).toContain("npm test");
    expect(readDemo("dependencies/correct/package.json")).toContain("3.24.1");
    expect(readDemo("dependencies/correct/package-lock.json")).toContain(
      "3.24.1",
    );
    expect(readDemo("breaking-change/correct/MIGRATION.md")).toContain(
      "calculatePayableTotal",
    );
  });
});
