import type { LabelSuggestion } from "../domain/label-suggestion.js";
import { isRegisteredIntent } from "./expert-policies.js";

export function selectPrimaryReviewIntent(
  suggestions: readonly LabelSuggestion[],
): string | null {
  const primary = suggestions.find((suggestion) =>
    isRegisteredIntent(suggestion.name),
  );
  return primary?.name.toLowerCase() ?? null;
}
