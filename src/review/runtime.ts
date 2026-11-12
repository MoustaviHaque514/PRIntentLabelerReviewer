import type { BugReviewExpert } from "./bug-review-expert.js";
import { GeminiBugReviewExpert } from "./gemini-bug-review-expert.js";
import { getExpertConfigurationService } from "../configuration/expert-configuration-runtime.js";
import type { ExpertProviderName } from "../configuration/expert-definitions.js";
import { createBugReviewExpert } from "./bug-review-expert-factory.js";
import type { LlmUsageMetrics } from "../llm/openai-compatible-provider.js";

export type BugReviewSelection = {
  expert: BugReviewExpert;
  metadata: {
    installationId: number;
    intention: "bug";
    provider: ExpertProviderName;
    model: string;
    source: "installation" | "environment";
  };
};

export class BugReviewConfigurationError extends Error {
  constructor() {
    super(
      "Impossible de charger la configuration de l’expert Bug. Vérifie les paramètres de l’installation et la disponibilité du service de configuration.",
    );
    this.name = "BugReviewConfigurationError";
  }
}

// Une seule lecture par analyse, aucune configuration ni clé en cache. Une
// panne n'est pas une absence de configuration : elle interdit le repli.
export async function resolveBugReviewExpert(
  installationId: number | undefined,
  onUsage?: (metrics: LlmUsageMetrics) => void,
): Promise<BugReviewSelection | null> {
  if (
    !installationId ||
    !Number.isSafeInteger(installationId) ||
    installationId <= 0
  ) {
    throw new BugReviewConfigurationError();
  }
  try {
    const configuration = await getExpertConfigurationService().resolve(
      installationId,
      "bug",
    );
    if (configuration) {
      return {
        expert: createBugReviewExpert(configuration, onUsage),
        metadata: {
          installationId,
          intention: "bug",
          provider: configuration.provider,
          model: configuration.model,
          source: "installation",
        },
      };
    }
    const environmentSelection = environmentBugReviewExpert(onUsage);
    if (!environmentSelection) {
      return null;
    }

    return {
      expert: environmentSelection.expert,
      metadata: {
        installationId,
        intention: "bug",
        provider: "gemini",
        model: environmentSelection.model,
        source: "environment",
      },
    };
  } catch {
    // Les erreurs SQL ou de construction peuvent contenir des secrets.
    throw new BugReviewConfigurationError();
  }
}

export function createEnvironmentBugReviewExpert(
  onUsage?: (metrics: LlmUsageMetrics) => void,
): BugReviewExpert | null {
  return environmentBugReviewExpert(onUsage)?.expert ?? null;
}

function environmentBugReviewExpert(
  onUsage?: (metrics: LlmUsageMetrics) => void,
): {
  expert: BugReviewExpert;
  model: string;
} | null {
  const apiKey = (
    process.env.GEMINI_REVIEW_API_KEY ?? process.env.GEMINI_API_KEY
  )?.trim();
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE") return null;

  const model =
    process.env.GEMINI_REVIEW_MODEL?.trim() || "gemini-3.5-flash-lite";
  return {
    expert: new GeminiBugReviewExpert(apiKey, model, undefined, onUsage),
    model,
  };
}
