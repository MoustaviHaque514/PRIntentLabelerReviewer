import { GeminiProvider } from "../llm/gemini-provider.js";
import { ConfigurableBugReviewExpert } from "./configurable-bug-review-expert.js";
import type { LlmUsageMetrics } from "../llm/openai-compatible-provider.js";

export class GeminiBugReviewExpert extends ConfigurableBugReviewExpert {
  constructor(
    apiKey: string,
    model: string,
    baseUrl = "https://generativelanguage.googleapis.com/v1beta",
    onUsage?: (metrics: LlmUsageMetrics) => void,
  ) {
    super(new GeminiProvider(apiKey, model, baseUrl, onUsage));
  }
}
