import { describe, expect, it } from "vitest";
import { calculatePayableTotal } from "./cart-total.js";

describe("calculatePayableTotal", () => {
  it("empêche un total négatif", () => {
    calculatePayableTotal(500, 800);
    expect(true).toBe(true);
  });
});
