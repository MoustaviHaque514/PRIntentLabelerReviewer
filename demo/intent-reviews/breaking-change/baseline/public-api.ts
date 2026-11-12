export function calculateTotal(subtotalCents: number): number {
  return subtotalCents;
}

export function renderTotal(subtotalCents: number): string {
  return `${calculateTotal(subtotalCents)} cents`;
}
