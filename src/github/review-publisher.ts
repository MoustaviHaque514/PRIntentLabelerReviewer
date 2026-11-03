import type { Context } from "probot";
import type { BugReviewResult } from "../domain/code-review.js";
import type { PullRequestData } from "../domain/pull-request-data.js";
import { listAllPages } from "./pagination.js";
import { isCommentOwnedByApp } from "./pr-commenter.js";

const REVIEW_MARKER_PREFIX = "<!-- llm-pr-bug-review";

type ReviewCommentIdentity = {
  body?: string | null;
  user?: { type?: string } | null;
  performed_via_github_app?: { id?: number } | null;
};

function safeReviewText(value: string): string {
  return value
    .replace(/@/g, "@\u200b")
    .replace(/<!--/g, "&lt;!--")
    .trim();
}

export async function publishBugReview(
  context: Context<"pull_request">,
  prData: PullRequestData,
  review: BugReviewResult,
): Promise<void> {
  if (review.findings.length === 0) return;

  const marker = `${REVIEW_MARKER_PREFIX} sha=${prData.headSha} -->`;
  const existing = await listAllPages<
    ReviewCommentIdentity,
    {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
    }
  >(context.octokit, context.octokit.pulls.listReviewComments, {
    owner: prData.owner,
    repo: prData.repo,
    pull_number: prData.number,
    per_page: 100,
  });

  if (
    existing.some(
      (comment) =>
        comment.body?.startsWith(marker) && isCommentOwnedByApp(comment),
    )
  ) {
    context.log.info(
      { pullNumber: prData.number, headSha: prData.headSha },
      "Specialized bug review already published",
    );
    return;
  }

  const comments = review.findings.map((finding) => ({
    path: finding.file,
    line: finding.endLine,
    side: "RIGHT" as const,
    ...(finding.startLine < finding.endLine
      ? { start_line: finding.startLine, start_side: "RIGHT" as const }
      : {}),
    body: `${marker}
**Problème :** ${safeReviewText(finding.message)}

**Solution proposée :** ${safeReviewText(finding.suggestion)}`,
  }));

  await context.octokit.pulls.createReview({
    owner: prData.owner,
    repo: prData.repo,
    pull_number: prData.number,
    commit_id: prData.headSha,
    event: "REQUEST_CHANGES",
    body: `Revue spécialisée — Bug

${safeReviewText(review.summary)}`,
    comments,
  });
}
