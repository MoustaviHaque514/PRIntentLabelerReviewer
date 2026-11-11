import type { CodeReviewResult } from "../domain/code-review.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import {
  LlmEmptyResponseError,
  LlmInvalidResponseError,
  LlmProviderRequestError,
  parseRetryAfterMs,
} from "../llm/provider-error.js";
import { retryLlmRequest } from "../llm/retry.js";
import { LLM_RESPONSE_TOKEN_RESERVE } from "../utils/constants.js";
import { getExpertPolicy } from "./expert-policies.js";
import type { ReviewExpert } from "./review-expert.js";
import { buildReviewPrompt, buildReviewSystemPrompt } from "./review-prompt.js";
import { parseReviewResult } from "./review-parser.js";

type GeminiReviewResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    findings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          file: { type: "STRING" },
          startLine: { type: "INTEGER" },
          endLine: { type: "INTEGER" },
          severity: {
            type: "STRING",
            enum: ["info", "warning", "error"],
          },
          message: { type: "STRING" },
          suggestion: { type: "STRING" },
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

export class GeminiReviewExpert implements ReviewExpert {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async review(
    context: PullRequestLlmContext,
    intent: string,
  ): Promise<CodeReviewResult> {
    const policy = getExpertPolicy(intent);
    if (!policy) {
      throw new LlmInvalidResponseError(
        `aucun expert de revue n'est enregistré pour « ${intent} »`,
      );
    }

    const content = await retryLlmRequest(() =>
      this.generateContent(context, policy.intent),
    );
    if (!content.trim()) {
      throw new LlmEmptyResponseError("Gemini review expert");
    }
    return parseReviewResult(content, context, policy.intent);
  }

  private async generateContent(
    context: PullRequestLlmContext,
    intent: string,
  ): Promise<string> {
    const policy = getExpertPolicy(intent);
    if (!policy) {
      throw new LlmInvalidResponseError(
        `aucun expert de revue n'est enregistré pour « ${intent} »`,
      );
    }

    const model = this.model.replace(/^models\//, "");
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildReviewSystemPrompt(policy) }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: buildReviewPrompt(context, policy) }],
            },
          ],
          generationConfig: {
            maxOutputTokens: LLM_RESPONSE_TOKEN_RESERVE,
            responseMimeType: "application/json",
            responseSchema: REVIEW_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response
      .json()
      .catch(() => ({}))) as GeminiReviewResponse;

    if (!response.ok) {
      throw new LlmProviderRequestError(
        "Gemini review expert",
        response.status,
        payload.error?.message,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }

    const candidate = payload.candidates?.[0];
    const text =
      candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text.trim() && candidate?.finishReason === "MAX_TOKENS") {
      throw new LlmEmptyResponseError(
        "Gemini review expert",
        "plafond de jetons de sortie épuisé",
      );
    }
    return text;
  }
}
