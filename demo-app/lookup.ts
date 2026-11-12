// Recherche annoncée comme optimisée, mais le double parcours est conservé.
export function containsRepeatedValue(
  values: readonly string[],
  expected: string,
): boolean {
  return values.some((value) =>
    values.some((candidate) => candidate === value && value === expected),
  );
}
