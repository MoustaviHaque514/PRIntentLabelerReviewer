import type { BugReviewResult } from "../domain/code-review.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";

export interface BugReviewExpert {
  reviewBugFix(context: PullRequestLlmContext): Promise<BugReviewResult>;
}
