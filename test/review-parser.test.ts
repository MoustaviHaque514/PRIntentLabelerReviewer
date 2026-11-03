import { describe, expect, it } from "vitest";
import type { PullRequestLlmContext } from "../src/domain/pull-request-data.js";
import { parseBugReviewResult } from "../src/review/review-parser.js";

function contextWithPatch(): PullRequestLlmContext {
  return {
    repository: { owner: "org", repo: "repo" },
    pullRequest: {
      number: 1,
      title: "fix: total négatif",
      body: "",
      author: "author",
      baseBranch: "main",
      headBranch: "fix/total",
      htmlUrl: "https://github.com/org/repo/pull/1",
    },
    totals: { additions: 2, deletions: 1, changedFilesCount: 1 },
    repositoryLabels: ["bug"],
    repositoryLabelDescriptions: {},
    allFilesSummary: [],
    fileRoleSummary: [],
    selectedFiles: [
      {
        file: {
          filename: "src/total.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          changes: 3,
          patch:
            "@@ -8,4 +8,5 @@ export function total\n context\n-old\n+new\n+added\n context",
        },
        score: 10,
        reasons: [],
        role: "source",
        contentPolicy: "include-patch",
      },
    ],
    summaryOnlyFilesCount: 0,
    omittedFilesCount: 0,
    selectedFilesCount: 1,
    promptBudget: {
      contextLimitTokens: 1000,
      responseReserveTokens: 200,
      nonPatchEstimatedTokens: 100,
      availablePatchTokens: 700,
      allocatedPatchTokens: 20,
      finalPromptEstimatedTokens: 120,
      files: [],
    },
  };
}

describe("parseBugReviewResult", () => {
  it("conserve un constat ancré sur une ligne modifiée visible", () => {
    const result = parseBugReviewResult(
      JSON.stringify({
        summary: "Le calcul reste incorrect.",
        findings: [
          {
            file: "src/total.ts",
            startLine: 9,
            endLine: 10,
            severity: "error",
            message: "Le cas négatif est incorrect.",
            suggestion: "Borner le total à zéro.",
          },
        ],
      }),
      contextWithPatch(),
    );

    expect(result.verdict).toBe("changes-requested");
    expect(result.findings).toHaveLength(1);
  });

  it("rejette les fichiers et lignes inventés par le modèle", () => {
    const result = parseBugReviewResult(
      JSON.stringify({
        summary: "Deux problèmes.",
        findings: [
          {
            file: "src/invented.ts",
            startLine: 1,
            endLine: 1,
            severity: "error",
            message: "Inventé.",
            suggestion: "Modifier.",
          },
          {
            file: "src/total.ts",
            startLine: 99,
            endLine: 99,
            severity: "warning",
            message: "Hors diff.",
            suggestion: "Modifier.",
          },
        ],
      }),
      contextWithPatch(),
    );

    expect(result).toMatchObject({ verdict: "approved", findings: [] });
  });
});
