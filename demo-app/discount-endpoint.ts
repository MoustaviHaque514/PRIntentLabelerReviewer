export type DiscountRequest = {
  code?: string;
  subtotalCents?: number;
};

export function quoteDiscount(request: DiscountRequest): number {
  if (request.code !== "SAVE10") return 0;
  return Math.floor((request.subtotalCents ?? 0) * 0.1);
}
