function clampToZero(amountCents: number): number {
  return Math.max(0, amountCents);
}

export function calculatePayableTotal(
  subtotalCents: number,
  discountCents: number,
): number {
  return clampToZero(subtotalCents - discountCents);
}
