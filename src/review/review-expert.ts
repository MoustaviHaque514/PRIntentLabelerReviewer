import type { CodeReviewResult } from "../domain/code-review.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";

export interface ReviewExpert {
  review(
    context: PullRequestLlmContext,
    intent: string,
  ): Promise<CodeReviewResult>;
}
