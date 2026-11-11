import { GeminiReviewExpert } from "./gemini-review-expert.js";
import type { ReviewExpert } from "./review-expert.js";

export function createEnvironmentReviewExpert(): ReviewExpert | null {
  const apiKey = (
    process.env.GEMINI_REVIEW_API_KEY ?? process.env.GEMINI_API_KEY
  )?.trim();
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE") return null;

  return new GeminiReviewExpert(
    apiKey,
    process.env.GEMINI_REVIEW_MODEL?.trim() || "gemini-3.5-flash-lite",
  );
}
