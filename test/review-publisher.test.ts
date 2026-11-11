import { afterEach, describe, expect, it, vi } from "vitest";
import type { BugReviewResult } from "../src/domain/code-review.js";
import type { PullRequestData } from "../src/domain/pull-request-data.js";
import { publishBugReview } from "../src/github/review-publisher.js";

const prData = {
  owner: "org",
  repo: "repo",
  number: 4,
  headSha: "abc123",
} as PullRequestData;

const review: BugReviewResult = {
  verdict: "changes-requested",
  summary: "Le calcul reste incorrect.",
  findings: [
    {
      file: "src/cart-total.ts",
      startLine: 19,
      endLine: 19,
      severity: "error",
      message: "Le total peut encore être négatif.",
      suggestion: "Borner le résultat final avec Math.max.",
    },
  ],
};

function createContext(existing: unknown[] = []) {
  return {
    octokit: {
      pulls: {
        listReviewComments: vi.fn().mockResolvedValue({ data: existing }),
        createReview: vi.fn().mockResolvedValue({}),
      },
    },
    log: { info: vi.fn() },
  };
}

afterEach(() => {
  delete process.env.APP_ID;
});

describe("publishBugReview", () => {
  it("publie une review Changes requested avec un commentaire inline", async () => {
    const context = createContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await publishBugReview(context as any, prData, review);

    expect(context.octokit.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "REQUEST_CHANGES",
        commit_id: "abc123",
        comments: [
          expect.objectContaining({
            path: "src/cart-total.ts",
            line: 19,
            side: "RIGHT",
            body: expect.stringContaining("**Solution proposée :**"),
          }),
        ],
      }),
    );
  });

  it("ne republie pas la même review pour le même SHA", async () => {
    process.env.APP_ID = "42";
    const context = createContext([
      {
        body: "<!-- llm-pr-bug-review sha=abc123 -->\nDéjà publié",
        user: { type: "Bot" },
        performed_via_github_app: { id: 42 },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await publishBugReview(context as any, prData, review);

    expect(context.octokit.pulls.createReview).not.toHaveBeenCalled();
  });
});
