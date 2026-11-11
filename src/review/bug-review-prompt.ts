import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import { getExpertPolicy } from "./expert-policies.js";
import { buildReviewPrompt, buildReviewSystemPrompt } from "./review-prompt.js";

export function buildBugReviewSystemPrompt(): string {
  const policy = getExpertPolicy("bug");
  if (!policy) {
    throw new Error("La politique de revue bug n'est pas enregistrée.");
  }
  return buildReviewSystemPrompt(policy);
}

export function buildBugReviewPrompt(context: PullRequestLlmContext): string {
  const policy = getExpertPolicy("bug");
  if (!policy) {
    throw new Error("La politique de revue bug n'est pas enregistrée.");
  }
  return buildReviewPrompt(context, policy);
}
