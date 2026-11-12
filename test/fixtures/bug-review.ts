import type { PullRequestData } from "../../src/domain/pull-request-data.js";
import type { ExpertProviderName } from "../../src/configuration/expert-definitions.js";
import { buildPullRequestLlmContext } from "../../src/llm/pr-context.js";

const pr: PullRequestData = {
  owner: "org",
  repo: "repo",
  number: 1,
  title: "fix negative total",
  body: "Fix totals",
  author: "author",
  baseBranch: "main",
  headBranch: "fix",
  headSha: "sha",
  htmlUrl: "",
  additions: 1,
  deletions: 1,
  changedFilesCount: 1,
  files: [
    {
      filename: "src/total.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: "@@ -1,2 +1,2 @@\n-old\n+new\n context",
    },
  ],
  repositoryLabels: ["bug"],
  pullRequestLabels: [],
};
export function reviewContext() {
  return buildPullRequestLlmContext(pr);
}
export const finding = {
  file: "src/total.ts",
  startLine: 1,
  endLine: 1,
  severity: "error",
  message: "Le total reste négatif.",
  suggestion: "Borner le total à zéro.",
};
export const reviewText = JSON.stringify({
  summary: "Une correction est nécessaire.",
  findings: [finding],
});

export function providerResponse(
  provider: ExpertProviderName,
  text: string,
  withUsage = false,
): Response {
  switch (provider) {
    case "openai":
      return Response.json({
        choices: [{ message: { content: text } }],
        ...(withUsage
          ? {
              usage: {
                prompt_tokens: 120,
                completion_tokens: 40,
                total_tokens: 160,
              },
            }
          : {}),
      });
    case "anthropic":
      return Response.json({
        content: [{ type: "text", text }],
        ...(withUsage
          ? {
              usage: {
                input_tokens: 100,
                output_tokens: 40,
                cache_creation_input_tokens: 5,
                cache_read_input_tokens: 15,
              },
            }
          : {}),
      });
    case "gemini":
      return Response.json({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
        ...(withUsage
          ? {
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 30,
                thoughtsTokenCount: 10,
                totalTokenCount: 160,
              },
            }
          : {}),
      });
  }
}
