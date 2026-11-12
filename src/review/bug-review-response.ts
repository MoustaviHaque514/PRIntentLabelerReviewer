import type { GenerationSchema } from "../llm/text-generator.js";
import { LlmInvalidResponseError } from "../llm/provider-error.js";
import { extractJsonObject } from "./review-parser.js";

export const BUG_REVIEW_SCHEMA: GenerationSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          startLine: { type: "integer" },
          endLine: { type: "integer" },
          severity: { type: "string", enum: ["info", "warning", "error"] },
          message: { type: "string" },
          suggestion: { type: "string" },
        },
        required: [
          "file",
          "startLine",
          "endLine",
          "severity",
          "message",
          "suggestion",
        ],
      },
    },
  },
  required: ["summary", "findings"],
};

export function validateBugReviewResponse(content: string): void {
  const parsed = extractJsonObject(content);
  if (
    typeof parsed.summary !== "string" ||
    !parsed.summary.trim() ||
    !Array.isArray(parsed.findings)
  ) {
    throw new LlmInvalidResponseError(
      "une revue doit contenir un résumé et un tableau findings",
    );
  }
  // Les règles de validité des constats et de leurs ancrages restent celles
  // du parseur existant. Ici, on écarte seulement les enveloppes non conformes.
}
