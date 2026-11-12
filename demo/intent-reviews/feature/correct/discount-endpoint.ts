export type DiscountRequest = {
  code?: string;
  subtotalCents?: number;
};

export function quoteDiscount(request: DiscountRequest): number {
  if (request.code !== "SAVE10") return 0;
  if (
    !Number.isInteger(request.subtotalCents) ||
    (request.subtotalCents ?? 0) < 0
  ) {
    throw new RangeError("Le sous-total doit être un entier positif.");
  }

  return Math.floor(request.subtotalCents * 0.1);
}
