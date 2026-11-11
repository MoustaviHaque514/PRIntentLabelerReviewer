import type { CodeReviewResult } from "../domain/code-review.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { BugReviewExpert } from "./bug-review-expert.js";
import { GeminiReviewExpert } from "./gemini-review-expert.js";

export class GeminiBugReviewExpert implements BugReviewExpert {
  private readonly expert: GeminiReviewExpert;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.expert = new GeminiReviewExpert(apiKey, model, baseUrl);
  }

  reviewBugFix(context: PullRequestLlmContext): Promise<CodeReviewResult> {
    return this.expert.review(context, "bug");
  }
}
