import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import { parsePullRequestAnalysis } from "./classification-parser.js";
import type { LlmProvider } from "./llm-provider.js";
import {
  generateTextSafely,
  type TextGenerator,
  type TextGenerationRequest,
} from "./text-generator.js";
import {
  LlmEmptyResponseError,
  LlmProviderRequestError,
  parseRetryAfterMs,
} from "./provider-error.js";
import { retryLlmRequest } from "./retry.js";
import {
  buildClassificationPrompt,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";
import { resolveLlmTokenBudget, type LlmTokenBudget } from "./model-budget.js";
import { estimateTokens } from "./patch-utils.js";
import type { LlmUsageMetrics } from "./openai-compatible-provider.js";

type AnthropicResponse = {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
};

export class AnthropicProvider implements LlmProvider, TextGenerator {
  public readonly tokenBudget: LlmTokenBudget;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.anthropic.com/v1",
    tokenBudget?: LlmTokenBudget,
    private readonly onUsage?: (metrics: LlmUsageMetrics) => void,
  ) {
    this.tokenBudget = tokenBudget ?? resolveLlmTokenBudget("anthropic", model);
  }

  async generate(request: TextGenerationRequest): Promise<string> {
    return generateTextSafely("Anthropic", request, () =>
      this.createMessage(
        request.system,
        request.prompt,
        request.maxOutputTokens,
      ),
    );
  }

  async classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis> {
    const content = await retryLlmRequest(() =>
      this.createMessage(
        buildClassificationSystemPrompt(),
        buildClassificationPrompt(context),
        this.tokenBudget.responseReserveTokens,
      ),
    );

    if (!content.trim()) {
      throw new LlmEmptyResponseError("Anthropic");
    }

    return parsePullRequestAnalysis(content);
  }

  // Le test de connexion valide seulement les identifiants : une réponse vide
  // reste acceptable ici, contrairement à une classification.
  async checkConnection(): Promise<void> {
    await this.createMessage(
      "Reply with the single word OK.",
      "Connection test.",
      this.tokenBudget.responseReserveTokens,
    );
  }

  private async createMessage(
    system: string,
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          system,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = (await response
      .json()
      .catch(() => ({}))) as AnthropicResponse;

    if (!response.ok) {
      throw new LlmProviderRequestError(
        "Anthropic",
        response.status,
        payload.error?.message,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }

    this.reportUsage(
      payload.usage,
      estimateTokens(system) + estimateTokens(prompt),
    );

    return (
      payload.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("") ?? ""
    );
  }

  private reportUsage(
    usage: AnthropicResponse["usage"],
    estimatedPromptTokens: number,
  ): void {
    if (!this.onUsage || !usage) return;
    const inputTokens = usage.input_tokens;
    const completionTokens = usage.output_tokens;
    if (typeof inputTokens !== "number" || typeof completionTokens !== "number")
      return;
    const counts = [
      inputTokens,
      completionTokens,
      usage.cache_creation_input_tokens ?? 0,
      usage.cache_read_input_tokens ?? 0,
    ];
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0))
      return;

    // Anthropic compte les lectures et créations du cache séparément de input_tokens.
    const promptTokens =
      inputTokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    const absolutePromptTokenError = Math.abs(
      promptTokens - estimatedPromptTokens,
    );
    this.onUsage({
      provider: "Anthropic",
      model: this.model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedPromptTokens,
      absolutePromptTokenError,
      promptTokenErrorPercentage:
        promptTokens === 0
          ? 0
          : (absolutePromptTokenError / promptTokens) * 100,
    });
  }
}
