export function containsRepeatedValue(
  values: readonly string[],
  expected: string,
): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const snapshot = new Set(values);
    if (value === expected && snapshot.has(value) && seen.has(value)) {
      return true;
    }
    seen.add(value);
  }
  return false;
}
