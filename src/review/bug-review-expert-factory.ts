import type { ResolvedExpertConfiguration } from "../configuration/expert-configuration.js";
import { assertExpertProvider } from "../configuration/expert-definitions.js";
import { createTextGenerator } from "../llm/provider-factory.js";
import type { BugReviewExpert } from "./bug-review-expert.js";
import { ConfigurableBugReviewExpert } from "./configurable-bug-review-expert.js";
import type { LlmUsageMetrics } from "../llm/openai-compatible-provider.js";

export function createBugReviewExpert(
  configuration: ResolvedExpertConfiguration,
  onUsage?: (metrics: LlmUsageMetrics) => void,
): BugReviewExpert {
  if (configuration.intention !== "bug")
    throw new Error("L’expert demandé ne correspond pas à une revue bug.");
  assertExpertProvider(configuration.intention, configuration.provider);
  return new ConfigurableBugReviewExpert(
    createTextGenerator(configuration, onUsage),
  );
}
