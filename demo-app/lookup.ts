export function containsRepeatedValue(
  values: readonly string[],
  expected: string,
): boolean {
  const seen = new Set<string>();
  return values.some((value) =>
    values.some((candidate) => {
      seen.add(candidate);
      return candidate === value && value === expected;
    }),
  );
}
