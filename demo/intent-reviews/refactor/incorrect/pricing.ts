function clampToZero(amountCents: number): number {
  return Math.max(1, amountCents);
}

export function calculatePayableTotal(
  subtotalCents: number,
  discountCents: number,
): number {
  return clampToZero(subtotalCents - discountCents);
}
