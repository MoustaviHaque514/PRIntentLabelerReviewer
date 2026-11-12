export function calculatePayableTotal(
  subtotalCents: number,
  discountCents: number,
): number {
  return Math.max(0, subtotalCents - discountCents);
}
