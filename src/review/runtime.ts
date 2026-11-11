import type { BugReviewExpert } from "./bug-review-expert.js";
import { GeminiBugReviewExpert } from "./gemini-bug-review-expert.js";

export function createEnvironmentBugReviewExpert(): BugReviewExpert | null {
  const apiKey = (
    process.env.GEMINI_REVIEW_API_KEY ?? process.env.GEMINI_API_KEY
  )?.trim();
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE") return null;

  return new GeminiBugReviewExpert(
    apiKey,
    process.env.GEMINI_REVIEW_MODEL?.trim() || "gemini-3.5-flash-lite",
  );
}
