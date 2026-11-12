import type { BugReviewResult } from "../domain/code-review.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { TextGenerator } from "../llm/text-generator.js";
import { estimateTokens } from "../llm/patch-utils.js";
import { retryLlmRequest } from "../llm/retry.js";
import { LlmEmptyResponseError } from "../llm/provider-error.js";
import type { BugReviewExpert } from "./bug-review-expert.js";
import {
  buildBugReviewPrompt,
  buildBugReviewSystemPrompt,
} from "./bug-review-prompt.js";
import {
  BUG_REVIEW_SCHEMA,
  validateBugReviewResponse,
} from "./bug-review-response.js";
import { parseBugReviewResult } from "./review-parser.js";

export class ConfigurableBugReviewExpert implements BugReviewExpert {
  constructor(private readonly generator: TextGenerator) {}

  async reviewBugFix(context: PullRequestLlmContext): Promise<BugReviewResult> {
    const system = buildBugReviewSystemPrompt();
    const prompt = buildBugReviewPrompt(context);
    // Inclure le schéma et une marge de protocole dans l'estimation, sans
    // modifier la sélection des fichiers ou tronquer silencieusement le diff.
    const estimatedTokens =
      estimateTokens(system) +
      estimateTokens(prompt) +
      estimateTokens(JSON.stringify(BUG_REVIEW_SCHEMA)) +
      128;
    if (estimatedTokens > this.generator.tokenBudget.promptTokenBudget) {
      throw new Error(
        "Le contexte de revue dépasse le budget du modèle de l’expert.",
      );
    }
    const content = await retryLlmRequest(() =>
      this.generator.generate({
        system,
        prompt,
        maxOutputTokens: this.generator.tokenBudget.responseReserveTokens,
        jsonSchema: BUG_REVIEW_SCHEMA,
      }),
    );
    if (!content.trim()) throw new LlmEmptyResponseError("L’expert bug");
    validateBugReviewResponse(content);
    return parseBugReviewResult(content, context);
  }
}
