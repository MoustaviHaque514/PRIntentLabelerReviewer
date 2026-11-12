import { describe, expect, it } from "vitest";
import { calculatePayableTotal } from "./cart-total.js";

describe("calculatePayableTotal", () => {
  it("borne une remise excessive à zéro", () => {
    expect(calculatePayableTotal(500, 800)).toBe(0);
  });
});
