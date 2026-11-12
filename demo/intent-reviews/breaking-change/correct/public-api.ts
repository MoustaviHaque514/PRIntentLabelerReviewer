export function calculatePayableTotal(subtotalCents: number): number {
  return subtotalCents;
}

export function renderTotal(subtotalCents: number): string {
  return `${calculatePayableTotal(subtotalCents)} cents`;
}
