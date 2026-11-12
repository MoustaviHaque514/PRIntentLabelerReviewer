import { AnthropicProvider } from "./anthropic-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import type { LlmProvider } from "./llm-provider.js";
import {
  OpenAiCompatibleProvider,
  type LlmUsageMetrics,
} from "./openai-compatible-provider.js";
import { PerplexityProvider } from "./perplexity-provider.js";
import {
  normalizeProviderBaseUrl,
  type LlmProviderConfiguration,
} from "./provider-configuration.js";
import { resolveLlmTokenBudget } from "./model-budget.js";
import type { TextGenerator } from "./text-generator.js";

export function createTextGenerator(
  configuration: LlmProviderConfiguration,
  onUsage?: (metrics: LlmUsageMetrics) => void,
): TextGenerator {
  if (!["anthropic", "openai", "gemini"].includes(configuration.provider)) {
    throw new Error(
      "Ce fournisseur ne prend pas en charge la génération pour les experts.",
    );
  }
  const provider = createLlmProvider(configuration, onUsage);
  if (
    provider instanceof AnthropicProvider ||
    provider instanceof OpenAiCompatibleProvider ||
    provider instanceof GeminiProvider
  ) {
    return provider;
  }
  throw new Error("Le générateur demandé est indisponible.");
}

export function createLlmProvider(
  configuration: LlmProviderConfiguration,
  onUsage?: (metrics: LlmUsageMetrics) => void,
): LlmProvider {
  const apiKey = configuration.apiKey.trim();
  const model = configuration.model.trim();

  if (!apiKey) throw new Error("La clé API du fournisseur est requise.");
  if (!model) throw new Error("Le modèle LLM est requis.");

  const baseUrl = normalizeProviderBaseUrl(
    configuration.provider,
    configuration.provider === "custom" ? configuration.baseUrl : undefined,
  );

  // Résolu une seule fois ici : c'est ce budget qui décide ensuite du nombre de
  // fichiers et de la taille des diffs envoyés au modèle choisi.
  const tokenBudget = resolveLlmTokenBudget(configuration.provider, model);

  switch (configuration.provider) {
    case "groq":
      return new GroqProvider(apiKey, model, baseUrl, onUsage, tokenBudget);
    case "openai":
      return new OpenAiCompatibleProvider({
        providerName: "OpenAI",
        apiKey,
        model,
        baseUrl,
        supportsJsonMode: true,
        usesMaxCompletionTokens: true,
        onUsage,
        tokenBudget,
      });
    case "anthropic":
      return new AnthropicProvider(
        apiKey,
        model,
        baseUrl,
        tokenBudget,
        onUsage,
      );
    case "gemini":
      return new GeminiProvider(apiKey, model, baseUrl, onUsage, tokenBudget);
    case "xai":
      return new OpenAiCompatibleProvider({
        providerName: "xAI",
        apiKey,
        model,
        baseUrl,
        supportsJsonMode: true,
        onUsage,
        tokenBudget,
      });
    case "perplexity":
      return new PerplexityProvider(apiKey, model, baseUrl, tokenBudget);
    case "custom":
      return new OpenAiCompatibleProvider({
        providerName: "API compatible OpenAI",
        apiKey,
        model,
        baseUrl,
        onUsage,
        tokenBudget,
      });
  }
}

export function createEnvironmentLlmProvider(
  onUsage?: (metrics: LlmUsageMetrics) => void,
): LlmProvider | null {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  if (groqApiKey && groqApiKey !== "REMPLACER_PAR_VOTRE_CLE") {
    return createLlmProvider(
      {
        provider: "groq",
        apiKey: groqApiKey,
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
      },
      onUsage,
    );
  }

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiApiKey && geminiApiKey !== "REMPLACER_PAR_VOTRE_CLE") {
    return createLlmProvider(
      {
        provider: "gemini",
        apiKey: geminiApiKey,
        model:
          process.env.GEMINI_MODEL ??
          process.env.GEMINI_REVIEW_MODEL ??
          "gemini-3.5-flash-lite",
      },
      onUsage,
    );
  }

  return null;
}
