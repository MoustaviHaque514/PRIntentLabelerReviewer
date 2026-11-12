import type { LlmProviderName } from "../llm/provider-configuration.js";

export const EXPERT_PROVIDER_NAMES = [
  "anthropic",
  "openai",
  "gemini",
] as const satisfies readonly LlmProviderName[];

export type ExpertProviderName = (typeof EXPERT_PROVIDER_NAMES)[number];

// Ajouter une intention ici lorsqu'elle devient configurable. Le routage des
// PR et la construction des experts restent indépendants de ce registre.
export const EXPERT_DEFINITIONS = {
  bug: {
    displayName: "Bug",
    providers: EXPERT_PROVIDER_NAMES,
  },
} as const;

export type ExpertIntention = keyof typeof EXPERT_DEFINITIONS;

export function isExpertIntention(value: unknown): value is ExpertIntention {
  return typeof value === "string" && Object.hasOwn(EXPERT_DEFINITIONS, value);
}

export function isExpertProviderName(
  value: unknown,
): value is ExpertProviderName {
  return (
    typeof value === "string" &&
    EXPERT_PROVIDER_NAMES.includes(value as ExpertProviderName)
  );
}

export function assertExpertIntention(
  value: unknown,
): asserts value is ExpertIntention {
  if (!isExpertIntention(value)) {
    throw new Error("Cette intention n’est pas configurable.");
  }
}

export function assertExpertProvider(
  intention: ExpertIntention,
  provider: unknown,
): asserts provider is ExpertProviderName {
  assertExpertIntention(intention);
  if (
    !isExpertProviderName(provider) ||
    !(EXPERT_DEFINITIONS[intention].providers as readonly string[]).includes(
      provider,
    )
  ) {
    throw new Error("Ce fournisseur n’est pas autorisé pour cet expert.");
  }
}
