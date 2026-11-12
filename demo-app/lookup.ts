export function containsRepeatedValue(
  values: readonly string[],
  expected: string,
): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (value === expected && seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}
