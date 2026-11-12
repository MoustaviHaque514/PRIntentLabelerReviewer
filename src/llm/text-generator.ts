import type { LlmTokenBudget } from "./model-budget.js";
import {
  LlmEmptyResponseError,
  LlmProviderRequestError,
} from "./provider-error.js";

// Sous-ensemble commun des schémas nécessaires aux sorties JSON des experts.
export type GenerationSchema = {
  type: "object" | "array" | "string" | "integer" | "number" | "boolean";
  properties?: Record<string, GenerationSchema>;
  items?: GenerationSchema;
  required?: string[];
  enum?: string[];
};

export type TextGenerationRequest = {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  jsonSchema?: GenerationSchema;
};

// Une génération = une requête. L'expert possède la politique de retry.
export interface TextGenerator {
  readonly tokenBudget: LlmTokenBudget;
  generate(request: TextGenerationRequest): Promise<string>;
}

export async function generateTextSafely(
  provider: string,
  request: TextGenerationRequest,
  operation: () => Promise<string>,
): Promise<string> {
  if (
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens <= 0
  ) {
    throw new Error("La limite de sortie doit être un entier positif.");
  }
  try {
    const text = await operation();
    if (!text.trim()) {
      throw new LlmEmptyResponseError(provider);
    }
    return text;
  } catch (error) {
    // Les détails d'une réponse HTTP ou d'une exception réseau peuvent contenir
    // des secrets. Ne conserver que les informations nécessaires au retry.
    if (error instanceof LlmProviderRequestError) {
      throw new LlmProviderRequestError(
        provider,
        error.status,
        undefined,
        error.retryAfterMs,
      );
    }
    if (error instanceof LlmEmptyResponseError) {
      throw new LlmEmptyResponseError(provider);
    }
    const safeError = new Error(`L’appel à ${provider} a échoué.`);
    if (
      error instanceof Error &&
      ["AbortError", "TimeoutError", "TypeError", "FetchError"].includes(
        error.name,
      )
    ) {
      safeError.name = error.name;
    }
    throw safeError;
  }
}
