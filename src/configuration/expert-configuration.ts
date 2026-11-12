import type {
  ChangeLlmConfigurationInput,
  LlmConfigurationSummary,
  ResolvedLlmConfiguration,
} from "./llm-configuration.js";
import type {
  ExpertIntention,
  ExpertProviderName,
} from "./expert-definitions.js";

type ExpertScope = {
  intention: ExpertIntention;
  provider: ExpertProviderName;
};

export type ChangeExpertConfigurationInput = Omit<
  ChangeLlmConfigurationInput,
  "provider"
> &
  ExpertScope;

export type TestExpertConfigurationInput = Omit<
  ChangeExpertConfigurationInput,
  "githubUserId"
>;

// Seul ce résumé peut être transmis à l'interface HTTP.
export type ExpertConfigurationSummary = Omit<
  LlmConfigurationSummary,
  "provider"
> &
  ExpertScope;

// Contient une clé déchiffrée : usage serveur uniquement, jamais de log ni de
// sérialisation HTTP.
export type ResolvedExpertConfiguration = Omit<
  ResolvedLlmConfiguration,
  "provider"
> &
  ExpertScope;

export interface ExpertConfigurationReader {
  // null = aucune configuration ; une panne de stockage/chiffrement lève une
  // erreur. Aucun repli vers Gemini ou vers le classifieur n'est effectué ici.
  resolve(
    installationId: number,
    intention: ExpertIntention,
  ): Promise<ResolvedExpertConfiguration | null>;
}

export class ExpertConfigurationUnavailableError extends Error {
  constructor() {
    super("Le service de configuration des experts est indisponible.");
    this.name = "ExpertConfigurationUnavailableError";
  }
}
